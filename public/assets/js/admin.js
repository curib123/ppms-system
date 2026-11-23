(function ($) {
    'use strict';

    $(function () {
        var $body = $('body').addClass('has-admin-js');
        var $toggle = $('[data-admin-menu-toggle]');
        var $navigation = $('#admin-navigation');
        var compact = window.matchMedia('(max-width: 760px)');

        function setNavigation(open) {
            $navigation.prop('hidden', !open);
            $toggle.attr('aria-expanded', String(open));
            $toggle.attr('aria-label', open ? 'Close navigation' : 'Open navigation');
        }

        if ($toggle.length) {
            $toggle.prop('hidden', false);
            setNavigation(!compact.matches);
            $toggle.on('click', function () {
                setNavigation($toggle.attr('aria-expanded') !== 'true');
            });
            compact.addEventListener('change', function () {
                setNavigation(!compact.matches);
            });
            $(document).on('keydown', function (event) {
                if (event.key === 'Escape' && compact.matches && $toggle.attr('aria-expanded') === 'true') {
                    setNavigation(false);
                    $toggle.trigger('focus');
                }
            });
            $navigation.on('click', 'a[href^="#"]', function () {
                if (compact.matches) {
                    setNavigation(false);
                    var target = document.getElementById(this.hash.slice(1));
                    if (target) { target.focus(); }
                }
            });
        }

        $('[data-password-toggle]').prop('hidden', false).on('click', function () {
            var input = document.getElementById(this.getAttribute('aria-controls'));
            var show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            $(this).attr('aria-pressed', String(show)).text(show ? 'Hide password' : 'Show password');
        });

        $('form[data-admin-submit]').on('submit', function () {
            $(this).find('button[type="submit"]').prop('disabled', true).text(this.getAttribute('data-admin-submit'));
        });
        $(window).on('pageshow', function () {
            $('form[data-admin-submit] button[type="submit"]').each(function () {
                $(this).prop('disabled', false).text(this.form.action === $body.attr('data-login-url') ? 'Sign in' : 'Sign out');
            });
        });

        $(document).ajaxError(function (_, response) {
            if (response.status === 401) {
                var login = new URL($body.attr('data-login-url'), window.location.href);
                if (login.origin === window.location.origin) { window.location.assign(login.href); }
            }
        });
    });
}(jQuery));
