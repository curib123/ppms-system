<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Ppms_problem extends RuntimeException
{
    public $status;
    public $details;

    public function __construct($message, $status = 422, $details = array())
    {
        parent::__construct($message);
        $this->status = $status;
        $this->details = $details;
    }
}
