<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>
<div class="signin-frame">
    <section class="signin-introduction" aria-labelledby="welcome-title">
        <div class="brand">
            <span class="brand-mark" aria-hidden="true">P</span>
            <span><span class="brand-name">PPMS</span><span class="brand-description">Control panel</span></span>
        </div>
        <div class="signin-introduction-copy">
            <p class="eyebrow">Production record oversight</p>
            <h1 id="welcome-title">A clear view of<br class="desktop-break"> your records.</h1>
            <p>A workspace for administrators and review teams to keep production records connected.</p>
        </div>
        <div class="signin-mobile-note">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M10 5h4M11 18.5h2"/></svg>
            <p>Entering production records?<br><strong>Use the personnel mobile app.</strong></p>
        </div>
    </section>
    <section class="signin-panel" aria-labelledby="signin-title">
        <div class="signin-form-heading">
            <span class="section-kicker">Welcome back</span>
            <h2 id="signin-title">Sign in to PPMS</h2>
            <p>Use your individual work account.</p>
        </div>
        <?php if ($error): ?>
            <div class="form-alert" role="alert" id="signin-error">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/></svg>
                <p><?= html_escape($error) ?></p>
            </div>
        <?php endif; ?>
        <form class="signin-form" action="<?= html_escape($urls['login']) ?>" method="post" data-admin-submit="Signing in..."<?= $error ? ' aria-describedby="signin-error"' : '' ?>>
            <input type="hidden" name="<?= html_escape($csrf['name']) ?>" value="<?= html_escape($csrf['hash']) ?>">
            <div class="form-field">
                <label for="admin-username">Username</label>
                <input class="form-input" id="admin-username" name="username" type="text" value="<?= html_escape((string) $username) ?>" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="191" required>
            </div>
            <div class="form-field">
                <label for="admin-password">Password</label>
                <div class="password-field">
                    <input class="form-input" id="admin-password" name="password" type="password" autocomplete="current-password" maxlength="1024" required>
                    <button class="password-toggle" type="button" data-password-toggle aria-controls="admin-password" aria-pressed="false" hidden>Show password</button>
                </div>
            </div>
            <button class="button button-primary signin-submit" type="submit">Sign in</button>
        </form>
        <p class="signin-help">Need access or help signing in?<br>Contact your PPMS administrator.</p>
        <div class="signin-security-note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
            <span>Individual accounts. Accountable work.</span>
        </div>
    </section>
</div>
<p class="signin-footer">PPMS <span aria-hidden="true">/</span> Administration &amp; review</p>
