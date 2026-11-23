<?php
defined('BASEPATH') OR exit('No direct script access allowed');
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>404 Page Not Found</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<?php include __DIR__ . '/_theme.php'; ?>
</head>
<body data-screen-label="System error">
	<main class="system-main"><section class="system-error">
		<h1><?php echo $heading; ?></h1>
		<?php echo $message; ?>
	</section></main>
</body>
</html>
