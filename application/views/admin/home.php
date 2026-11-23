<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>
<section class="overview-heading" aria-labelledby="overview-title">
    <p class="section-kicker">Your workspace</p>
    <h1 id="overview-title">Overview</h1>
    <p>Welcome, <strong><?= html_escape($actor['displayName']) ?></strong>.</p>
</section>
<div class="overview-grid">
    <section class="workspace-card account-card" id="account" aria-labelledby="account-title" tabindex="-1">
        <div class="card-heading">
            <span class="card-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1.5a7 7 0 0 1 14 0V20"/></svg></span>
            <div><p class="eyebrow">Signed-in account</p><h2 id="account-title">Your account</h2></div>
        </div>
        <dl class="account-details">
            <div><dt>Name</dt><dd><?= html_escape($actor['displayName']) ?></dd></div>
            <div><dt>Username</dt><dd><?= html_escape($actor['username']) ?></dd></div>
            <div><dt>Role</dt><dd><span class="role-badge"><?= html_escape($roleLabel) ?></span></dd></div>
        </dl>
        <p class="card-note">Always use your own account so your work is attributed to you. Sign out when you finish on a shared computer.</p>
    </section>
    <section class="workspace-card guidance-card" aria-labelledby="guidance-title">
        <div class="card-heading">
            <span class="card-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3.5h8a2 2 0 0 1 2 2v15H6v-15a2 2 0 0 1 2-2Z"/><path d="M9 3.5v3h6v-3M9 11h6M9 15h4"/></svg></span>
            <div><p class="eyebrow">Record quality</p><h2 id="guidance-title">Clear review guidance</h2></div>
        </div>
        <p>Checked, Reviewed and Approved show which record checks have been completed.</p>
        <div class="guidance-labels" aria-label="Review indicators">
            <span>Checked</span><span>Reviewed</span><span>Approved</span>
        </div>
        <p class="card-note">These indicators guide input corrections. Connected work can continue while reviews are pending.</p>
    </section>
</div>
<section class="mobile-entry-note" aria-labelledby="mobile-entry-title">
    <span class="card-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6.5" y="2.5" width="11" height="19" rx="2"/><path d="M10 5h4M11 18.5h2"/></svg></span>
    <div><h2 id="mobile-entry-title">Personnel record entry</h2><p>Personnel enter and synchronize production records in the mobile app.</p></div>
</section>
