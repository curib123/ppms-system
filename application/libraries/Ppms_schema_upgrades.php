<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Version one is sealed; subsequent SQL versions have independent checksums. */
class Ppms_schema_upgrades
{
    public function migrate()
    {
        $ci =& get_instance();
        $ci->load->library(array('ppms_migrations','ppms_database'));
        $connection = $ci->ppms_database->connection();
        $database = $connection->query('SELECT DATABASE()')->fetch_row()[0];
        $lock = 'ppms-install-'.substr(hash('sha256', $database), 0, 40);
        if ((int) $connection->query("SELECT GET_LOCK('".$lock."',10)")->fetch_row()[0] !== 1) { throw new RuntimeException('Another database migration is running.'); }
        try {
            // Keep the original migration implementation byte-for-byte sealed.
            // Its FK-dependent generated expression is invalid on supported engines.
            // Prepare the equivalent, FK-independent constraint under the same lock
            // before invoking it. This also resumes partially applied version one.
            $this->prepareActiveTemplateConstraint($connection);
            $result = $ci->ppms_migrations->migrate();
            $paths = glob(dirname(APPPATH).'/database/migrations/*.sql');
            sort($paths, SORT_STRING);
            foreach ($paths as $path) {
                $version = basename($path, '.sql');
                if ($version === '202610230001_offline_sync') { continue; }
                $sql = file_get_contents($path);
                $checksum = hash('sha256', $sql);
                $statement = $connection->prepare('SELECT checksum FROM PpmsSchemaMigration WHERE version=?');
                $statement->bind_param('s', $version);
                $statement->execute();
                $applied = $statement->get_result()->fetch_assoc();
                if ($applied) {
                    if (!hash_equals($applied['checksum'], $checksum)) { throw new RuntimeException('Applied migration checksum differs: '.$version); }
                } else {
                    $connection->multi_query($sql);
                    do {
                        $query = $connection->store_result();
                        if ($query instanceof mysqli_result) { $query->free(); }
                        if (!$connection->more_results()) { break; }
                        $connection->next_result();
                    } while (TRUE);
                    $statement = $connection->prepare('INSERT INTO PpmsSchemaMigration (version,checksum) VALUES (?,?)');
                    $statement->bind_param('ss', $version, $checksum);
                    $statement->execute();
                }
                $result['version'] = $version;
            }
            return $result;
        } finally { $connection->query("SELECT RELEASE_LOCK('".$lock."')"); }
    }

    private function prepareActiveTemplateConstraint($connection)
    {
        $connection->query('SELECT id FROM PpmTemplateVersion LIMIT 1');
        $column = $connection->query("SELECT GENERATION_EXPRESSION FROM information_schema.columns
            WHERE table_schema=DATABASE() AND table_name='PpmTemplateVersion' AND column_name='activePpmFormId'")->fetch_assoc();
        $index = $connection->query("SELECT GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columnsList,MIN(non_unique) AS nonUnique
            FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='PpmTemplateVersion'
            AND index_name='uq_active_template_form'")->fetch_assoc();
        $expression = "VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN isActive=1 THEN 'ACTIVE' ELSE NULL END) STORED";
        if ($column && $index['columnsList'] === 'ppmFormId,activePpmFormId' && (int) $index['nonUnique'] === 0
            && stripos($column['GENERATION_EXPRESSION'], 'ppmFormId') === FALSE
            && stripos($column['GENERATION_EXPRESSION'], 'isActive') !== FALSE) { return; }
        if ($column && (!$column['GENERATION_EXPRESSION'] || stripos($column['GENERATION_EXPRESSION'], 'isActive') === FALSE)) {
            throw new RuntimeException('Unexpected active-template constraint; review the schema before upgrading.');
        }
        $changes = array();
        if ($index['columnsList']) { $changes[] = 'DROP INDEX uq_active_template_form'; }
        $changes[] = ($column ? 'MODIFY COLUMN ' : 'ADD COLUMN ').'activePpmFormId '.$expression;
        $changes[] = 'ADD UNIQUE INDEX uq_active_template_form (ppmFormId,activePpmFormId)';
        $connection->query('ALTER TABLE PpmTemplateVersion '.implode(', ', $changes));
    }
}
