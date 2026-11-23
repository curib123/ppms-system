<?php
defined('BASEPATH') OR exit('No direct script access allowed');
$roleLabels = array('ADMIN' => 'Administrator', 'FSQA' => 'FSQA', 'SUPERVISOR' => 'Supervisor', 'PLANT_MANAGER' => 'Plant manager');
$roleLabel = $actor ? ($roleLabels[$actor['role']] ?? 'PPMS user') : '';
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-name" content="<?= html_escape($csrf['name']) ?>">
    <meta name="csrf-token" content="<?= html_escape($csrf['hash']) ?>">
    <title><?= html_escape($pageTitle) ?> | PPMS</title>
    <link rel="stylesheet" href="<?= html_escape($urls['css']) ?>">
    <script src="<?= html_escape($urls['jquery']) ?>" defer></script>
    <script src="<?= html_escape($urls['js']) ?>" defer></script>
</head>
<body class="<?= $actor ? 'admin-page' : 'admin-signin' ?>" data-login-url="<?= html_escape($urls['login']) ?>">
<a class="skip-link" href="#admin-main">Skip to main content</a>
<?php if ($actor): ?>
    <div class="admin-shell">
        <aside class="admin-sidebar" aria-label="Workspace navigation">
            <div class="sidebar-brand-row">
                <a class="brand" href="<?= html_escape($urls['home']) ?>" aria-label="PPMS overview">
                    <span class="brand-mark" aria-hidden="true">P</span>
                    <span><span class="brand-name">PPMS</span><span class="brand-description">Control panel</span></span>
                </a>
                <button class="admin-nav-toggle" type="button" data-admin-menu-toggle aria-label="Open navigation" aria-controls="admin-navigation" aria-expanded="true" hidden>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
                    <span>Menu</span>
                </button>
            </div>
            <nav id="admin-navigation" class="admin-navigation" aria-label="Main navigation">
                <p class="nav-caption">Workspace</p>
                <a class="nav-link is-current" href="<?= html_escape($urls['home']) ?>" aria-current="page">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><rect x="14.5" y="14.5" width="6" height="6" rx="1"/></svg>
                    <span>Overview</span>
                </a>
                <a class="nav-link" href="#account">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1.5a7 7 0 0 1 14 0V20"/></svg>
                    <span>Account</span>
                </a>
            </nav>
            <div class="sidebar-footer">
                <span class="sidebar-footer-label">Signed in as</span>
                <strong><?= html_escape($roleLabel) ?></strong>
                <span>Personnel enter production records in the mobile app.</span>
            </div>
        </aside>
        <div class="admin-workspace">
            <header class="workspace-header">
                <div><p class="eyebrow">PPMS workspace</p><p class="header-title">Overview</p></div>
                <form action="<?= html_escape($urls['logout']) ?>" method="post" data-admin-submit="Signing out...">
                    <input type="hidden" name="<?= html_escape($csrf['name']) ?>" value="<?= html_escape($csrf['hash']) ?>">
                    <button class="button button-secondary" type="submit">Sign out</button>
                </form>
            </header>
            <main id="admin-main" class="workspace-main" tabindex="-1">
                <?php $this->load->view($contentView, array('actor' => $actor, 'roleLabel' => $roleLabel, 'error' => $error, 'username' => $username, 'urls' => $urls, 'csrf' => $csrf)); ?>
            </main>
            <footer class="workspace-footer">PPMS <span aria-hidden="true">/</span> Production record oversight</footer>
        </div>
    </div>
<?php else: ?>
    <main id="admin-main" class="signin-main" tabindex="-1">
        <?php $this->load->view($contentView, array('actor' => NULL, 'error' => $error, 'username' => $username, 'urls' => $urls, 'csrf' => $csrf)); ?>
    </main>
<?php endif; ?>
</body>
</html>
