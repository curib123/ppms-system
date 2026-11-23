"""Real browser-session HTTP checks against a private disposable PPMS database."""
import http.cookiejar
from html.parser import HTMLParser
import json
import re
import secrets
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, Request, build_opener

from integration import DATABASE, ENV, PHP, ROOT, cli, sql


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


class FormInputs(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.inputs = []
        self.feed(html)

    def handle_starttag(self, tag, attributes):
        if tag == 'input':
            self.inputs.append(dict(attributes))


class AdminIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sql('CREATE DATABASE `' + DATABASE + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', None)
        cls.addClassCleanup(lambda: sql('DROP DATABASE `' + DATABASE + '`', None))
        for command in ('install', 'migrate'):
            result = cli('setup', command)
            if result.returncode:
                raise AssertionError('Disposable setup failed: ' + result.stdout + result.stderr)
        cls.password = secrets.token_urlsafe(24)
        cls.sessions = tempfile.TemporaryDirectory(prefix='ppms_admin_sessions_')
        cls.addClassCleanup(cls.sessions.cleanup)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            cls.port = listener.getsockname()[1]
        cls.base = 'http://127.0.0.1:' + str(cls.port)
        cls.env = dict(ENV, APP_BASE_URL=cls.base + '/', APP_ENCRYPTION_KEY=secrets.token_hex(32),
                       APP_SESSION_PATH=cls.sessions.name, PPMS_TEST_PASSWORD=cls.password,
                       PLANT_TIMEZONE='Asia/Manila')
        fixture = subprocess.run(PHP + ['tests/api_fixture.php'], cwd=ROOT, env=cls.env,
                                 text=True, capture_output=True, timeout=15)
        if fixture.returncode:
            raise AssertionError('Disposable account fixture failed')
        cls.log = tempfile.TemporaryFile()
        cls.addClassCleanup(cls.log.close)
        cls.server = subprocess.Popen(PHP + ['-S', '127.0.0.1:' + str(cls.port), '-t', 'public', 'public/router.php'],
                                      cwd=ROOT, env=cls.env, stdout=cls.log, stderr=cls.log,
                                      creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        cls.addClassCleanup(cls.stop_server)
        for _ in range(60):
            try:
                with socket.create_connection(('127.0.0.1', cls.port), timeout=0.1):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise AssertionError('Disposable admin HTTP server did not start')

    @classmethod
    def stop_server(cls):
        cls.server.terminate()
        cls.server.wait(timeout=5)

    def setUp(self):
        self.cookies = http.cookiejar.CookieJar()
        self.browser = build_opener(HTTPCookieProcessor(self.cookies), NoRedirect())

    def request(self, method, path, data=None, headers=None):
        request_headers = dict(headers or {})
        payload = None
        if data is not None:
            payload = urlencode(data).encode()
            request_headers.setdefault('Content-Type', 'application/x-www-form-urlencoded')
        request = Request(self.base + path, data=payload, method=method, headers=request_headers)
        try:
            response = self.browser.open(request, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read().decode('utf-8')

    def csrf(self, html):
        matches = [item for item in FormInputs(html).inputs if item.get('name') == 'ppms_csrf_token']
        self.assertTrue(matches, 'Page must contain a CSRF form token')
        return {'ppms_csrf_token': matches[0]['value']}

    def login(self, username='admin', password=None, ajax=False):
        status, headers, html = self.request('GET', '/admin/login')
        self.assertEqual(status, 200, 'Login page must be available')
        data = dict(self.csrf(html), username=username,
                    password=self.password if password is None else password)
        headers = {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'} if ajax else {}
        return self.request('POST', '/admin/login', data, headers)

    def test_01_protected_page_redirects_without_a_session(self):
        status, headers, html = self.request('GET', '/admin')
        self.assertEqual(status, 303)
        self.assertEqual(urlparse(headers['Location']).path, '/admin/login')

    def test_02_ajax_unauthenticated_requests_receive_json_instead_of_html(self):
        for headers in ({'Accept': 'application/json'}, {'X-Requested-With': 'XMLHttpRequest'}):
            with self.subTest(headers=headers):
                status, response_headers, body = self.request('GET', '/admin', headers=headers)
                self.assertEqual(status, 401)
                self.assertTrue(response_headers.get('Content-Type', '').startswith('application/json'))
                self.assertIn('error', json.loads(body))

    def test_03_login_form_uses_csrf_and_rejects_a_missing_token(self):
        status, headers, html = self.request('GET', '/admin/login')
        self.assertEqual(status, 200)
        self.csrf(html)
        self.assertTrue(any(cookie.name == 'ppms_csrf' for cookie in self.cookies))
        self.assertEqual(self.request('POST', '/admin/login',
                                    {'username': 'admin', 'password': self.password})[0], 403)
        self.assertEqual(sql('SELECT COUNT(*) FROM AuthSession'), '0')

    def test_04_login_rejects_invalid_credentials_without_echoing_secrets(self):
        status, headers, html = self.login(password='definitely-invalid-fixture-password')
        self.assertEqual(status, 401)
        self.csrf(html)
        self.assertFalse('definitely-invalid-fixture-password' in html, 'Login must not echo passwords')
        self.assertFalse('passwordHash' in html, 'Login must not expose stored credential fields')
        self.assertEqual(self.request('GET', '/admin')[0], 303)

    def test_05_login_validation_does_not_create_an_auth_session(self):
        before = sql('SELECT COUNT(*) FROM AuthSession')
        status, headers, html = self.request('GET', '/admin/login')
        self.assertEqual(status, 200)
        bad = dict(self.csrf(html), username='', password=self.password)
        self.assertEqual(self.request('POST', '/admin/login', bad)[0], 422)
        self.assertEqual(sql('SELECT COUNT(*) FROM AuthSession'), before)

    def test_06_each_admin_reviewer_role_can_access_the_shell(self):
        for username in ('admin', 'fsqa', 'supervisor', 'manager'):
            with self.subTest(role=username):
                self.cookies.clear()
                status, headers, body = self.login(username)
                self.assertEqual(status, 303)
                self.assertEqual(urlparse(headers['Location']).path, '/admin')
                status, headers, html = self.request('GET', '/admin')
                self.assertEqual(status, 200)
                self.assertEqual(headers.get('Cache-Control'), 'no-store')
                self.assertIn(username, html.lower())
                self.assertFalse(self.password in html, 'Shell must not expose supplied passwords')
                self.assertFalse(re.search(r'\b[a-f0-9]{64}\b', html), 'Shell must not expose bearer credentials')
                self.csrf(html)
        self.assertEqual(sql('SELECT COUNT(*) FROM ClientDevice'), '0')

    def test_07_personnel_cannot_create_an_admin_session(self):
        status, headers, html = self.login('alice')
        self.assertEqual(status, 403)
        self.assertEqual(self.request('GET', '/admin')[0], 303)
        self.assertEqual(sql("SELECT COUNT(*) FROM AuthSession WHERE userId='test-alice' AND revokedAt IS NULL"), '0')
        for alias in ('/admin/index', '/index.php/admin', '/admin/render', '/admin/actor'):
            with self.subTest(alias=alias):
                self.assertIn(self.request('GET', alias)[0], (303, 404))

    def test_08_login_rotates_the_session_and_invalidates_its_old_cookie(self):
        status, headers, html = self.request('GET', '/admin/login')
        self.assertEqual(status, 200)
        old = next((cookie.value for cookie in self.cookies if cookie.name == 'ppms_admin_session'), None)
        data = dict(self.csrf(html), username='admin', password=self.password)
        status, headers, html = self.request('POST', '/admin/login', data)
        self.assertEqual(status, 303)
        new = next((cookie.value for cookie in self.cookies if cookie.name == 'ppms_admin_session'), None)
        self.assertTrue(old and new and old != new, 'Successful login must rotate the session cookie')
        session_headers = [value for value in headers.get_all('Set-Cookie', []) if value.startswith('ppms_admin_session=')]
        self.assertTrue(session_headers, 'Login must return the regenerated session cookie')
        self.assertTrue(all('httponly' in value.lower() and 'samesite=lax' in value.lower()
                            for value in session_headers), 'Session cookie must be HttpOnly and SameSite Lax')
        self.assertEqual(self.request('GET', '/admin')[0], 200)
        status, headers, html = self.request('GET', '/admin', headers={'Cookie': 'ppms_admin_session=' + old})
        self.assertEqual(status, 303)

    def test_09_logout_requires_post_and_csrf_then_revokes_the_underlying_session(self):
        before = set(filter(None, sql("SELECT COALESCE(GROUP_CONCAT(id), '') FROM AuthSession WHERE userId='test-admin'").split(',')))
        self.assertEqual(self.login()[0], 303)
        after = set(filter(None, sql("SELECT COALESCE(GROUP_CONCAT(id), '') FROM AuthSession WHERE userId='test-admin'").split(',')))
        self.assertEqual(len(after - before), 1)
        session_id = next(iter(after - before))
        self.assertEqual(self.request('GET', '/admin/logout')[0], 405)
        self.assertEqual(self.request('POST', '/admin/logout', {})[0], 403)
        status, headers, html = self.request('GET', '/admin')
        self.assertEqual(status, 200)
        status, headers, html = self.request('POST', '/admin/logout', self.csrf(html))
        self.assertEqual(status, 303)
        self.assertEqual(urlparse(headers['Location']).path, '/admin/login')
        self.assertEqual(sql("SELECT COUNT(*) FROM AuthSession WHERE id='" + session_id + "' AND revokedAt IS NOT NULL"), '1')
        self.assertEqual(self.request('GET', '/admin')[0], 303)

    def test_10_expired_sessions_are_rechecked_for_html_and_ajax(self):
        for ajax in (False, True):
            with self.subTest(ajax=ajax):
                self.cookies.clear()
                self.assertEqual(self.login()[0], 303)
                sql("UPDATE AuthSession SET expiresAt='2000-01-01 00:00:00' WHERE userId='test-admin'")
                headers = {'Accept': 'application/json'} if ajax else {}
                status, response_headers, body = self.request('GET', '/admin', headers=headers)
                self.assertEqual(status, 401 if ajax else 303)
                if ajax:
                    self.assertIn('error', json.loads(body))

    def test_11_revoked_sessions_are_rechecked_on_the_next_request(self):
        self.assertEqual(self.login('fsqa')[0], 303)
        sql("UPDATE AuthSession SET revokedAt=UTC_TIMESTAMP(3) WHERE userId='test-fsqa' AND revokedAt IS NULL")
        status, headers, body = self.request('GET', '/admin', headers={'X-Requested-With': 'XMLHttpRequest'})
        self.assertEqual(status, 401)
        self.assertIn('error', json.loads(body))

    def test_12_inactive_accounts_and_changed_roles_lose_access(self):
        self.assertEqual(self.login('supervisor')[0], 303)
        sql("UPDATE User SET accountStatus='INACTIVE' WHERE id='test-supervisor'")
        try:
            self.assertEqual(self.request('GET', '/admin')[0], 303)
        finally:
            sql("UPDATE User SET accountStatus='ACTIVE' WHERE id='test-supervisor'")
        self.cookies.clear()
        self.assertEqual(self.login('manager')[0], 303)
        sql("UPDATE User SET role='PERSONNEL' WHERE id='test-manager'")
        try:
            self.assertEqual(self.request('GET', '/admin')[0], 403)
            self.assertEqual(self.request('GET', '/admin')[0], 303)
        finally:
            sql("UPDATE User SET role='PLANT_MANAGER' WHERE id='test-manager'")

    def test_13_browser_cookies_do_not_authenticate_the_json_api(self):
        self.assertEqual(self.login()[0], 303)
        status, headers, body = self.request('GET', '/api/v1/me')
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body)['error'], 'AUTHENTICATION_REQUIRED')

    def test_14_browser_login_reuses_the_api_login_throttle(self):
        try:
            for _ in range(6):
                self.assertEqual(self.login('outsider', password='wrong-fixture-password')[0], 401)
            # A correct password cannot bypass the defense through the browser or API.
            self.assertEqual(self.login('outsider')[0], 401)
            payload = json.dumps({'username': 'outsider', 'password': self.password}).encode()
            request = Request(self.base + '/api/v1/auth/login', data=payload, method='POST',
                              headers={'Content-Type': 'application/json'})
            try:
                response = self.browser.open(request, timeout=15)
            except HTTPError as error:
                response = error
            with response:
                self.assertEqual(response.status, 401)
                self.assertEqual(json.loads(response.read())['error'], 'INVALID_CREDENTIALS')
        finally:
            sql('UPDATE AuthLoginDefense SET failureCount=0,lockedUntil=NULL')

    def test_15_ajax_login_logout_still_require_csrf_and_use_json(self):
        status, headers, body = self.login(ajax=True)
        self.assertEqual(status, 200)
        self.assertEqual(urlparse(json.loads(body)['redirect']).path, '/admin')
        status, headers, html = self.request('GET', '/admin')
        self.assertEqual(status, 200)
        status, headers, body = self.request('POST', '/admin/logout', self.csrf(html), {'Accept': 'application/json'})
        self.assertEqual(status, 200)
        self.assertEqual(urlparse(json.loads(body)['redirect']).path, '/admin/login')
        self.assertEqual(self.request('GET', '/admin', headers={'Accept': 'application/json'})[0], 401)


if __name__ == '__main__':
    unittest.main(verbosity=2)
