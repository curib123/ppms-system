<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Read-only access to the original PPMS reference tables. */
class Ppms_reference_model extends CI_Model
{
    public function __construct()
    {
        parent::__construct();
        $this->load->library('ppms_database');
        $this->ppms_database->connection();
    }

    public function summary()
    {
        $counts = array();
        foreach (array('ProductionArea', 'PpmForm', 'PpmTemplateVersion', 'PpmTraceConnection', 'SystemSetting') as $table) {
            $counts[$table] = (int) $this->db->count_all($table);
        }
        return $counts;
    }

    public function forms()
    {
        return $this->db->select('ppmCode, title, status')
            ->from('PpmForm')->order_by('sortOrder', 'ASC')->order_by('ppmCode', 'ASC')
            ->get()->result_array();
    }
}
