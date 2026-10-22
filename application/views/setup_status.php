<?php defined('BASEPATH') OR exit('No direct script access allowed'); ?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PPMS Â· System setup</title>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; background: #f4f7fb; color: #172940; font: 16px/1.6 system-ui, sans-serif; }
        main { max-width: 960px; margin: 48px auto; padding: 0 24px; }
        h1 { font-size: 2rem; margin: 0; }
        h2 { font-size: 1.15rem; margin-top: 0; }
        .muted { color: #52647a; }
        .panel { background: white; border: 1px solid #dae2ed; border-radius: 12px; padding: 24px; margin: 24px 0; }
        .status { color: <?= $connected ? '#14623c' : '#8b4a09' ?>; font-weight: 600; }
        dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 16px; }
        dt { color: #52647a; font-size: .9rem; }
        dd { margin: 0; font-size: 1.6rem; font-weight: 600; }
        .scroll { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; text-align: left; font-size: .9rem; }
        th, td { padding: 12px 8px; border-bottom: 1px solid #e6ecf3; vertical-align: top; }
        code { overflow-wrap: anywhere; }
        @media (max-width: 600px) { main { margin-top: 24px; padding: 0 16px; } .panel { padding: 16px; } }
    </style>
</head>
<body>
<main>
    <h1>PPMS</h1>
    <p class="muted">CodeIgniter 3 Â· MySQL / MariaDB</p>
    <section class="panel" aria-labelledby="setup-heading">
        <h2 id="setup-heading">System setup</h2>
        <p class="status"><?= $connected ? 'Database connected' : 'Database setup needed' ?></p>
        <?php if ($connected): ?>
            <dl>
                <?php foreach (array('ProductionArea' => 'Areas', 'PpmForm' => 'PPM forms', 'PpmTemplateVersion' => 'Templates', 'PpmTraceConnection' => 'Connections', 'SystemSetting' => 'Settings') as $table => $label): ?>
                    <div><dt><?= html_escape($label) ?></dt><dd><?= (int) $counts[$table] ?></dd></div>
                <?php endforeach; ?>
            </dl>
        <?php else: ?>
            <p>Configure the MySQL / MariaDB connection using the README. For a new, empty database, run <code>php index.php setup install</code> from the project folder.</p>
        <?php endif; ?>
    </section>
    <?php if ($connected): ?>
        <section class="panel" aria-labelledby="forms-heading">
            <h2 id="forms-heading">PPM form register</h2>
            <div class="scroll">
                <table>
                    <caption class="muted">Reference forms in the configured database</caption>
                    <thead><tr><th scope="col">Code</th><th scope="col">Title</th><th scope="col">Status</th></tr></thead>
                    <tbody>
                        <?php foreach ($forms as $form): ?>
                            <tr><td><?= html_escape($form['ppmCode']) ?></td><td><?= html_escape($form['title']) ?></td><td><?= html_escape($form['status']) ?></td></tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </section>
    <?php endif; ?>
</main>
</body>
</html>
