# Framework source

CodeIgniter **3.1.13**, MIT license, vendored from
https://github.com/bcit-ci/CodeIgniter/tree/3.1.13
at commit `bcb17eb8ba53a85de154439d0ab8ff1bed047bc9`.

`system/` is unchanged upstream code. The standard `application/` structure
is retained with PPMS configuration, controllers, model, and view added.
The upstream front controller is in `public/index.php` with absolute paths
to `system/` and `application/`, and production as the default environment.

No Composer or Node.js dependency is required to run this PHP application.
