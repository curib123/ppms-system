<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Explicit, resumable MySQL DDL upgrades. Never called by web startup. */
class Ppms_migrations
{
    private $connection;

    public function migrate()
    {
        $ci =& get_instance();
        $ci->load->library('ppms_database');
        $this->connection = $ci->ppms_database->connection();
        $database = $this->connection->query('SELECT DATABASE()')->fetch_row()[0];
        $lock = 'ppms-install-'.substr(hash('sha256', $database), 0, 40);
        $statement = $this->connection->prepare('SELECT GET_LOCK(?, 10)');
        $statement->bind_param('s', $lock);
        $statement->execute();
        if ((int) $statement->get_result()->fetch_row()[0] !== 1) {
            throw new RuntimeException('Another database migration is running.');
        }
        try {
            // Refuse an uninitialized or incompatible database before creating anything.
            $this->connection->query('SELECT id FROM PpmForm LIMIT 1');
            $this->connection->query('CREATE TABLE IF NOT EXISTS PpmsSchemaMigration (
                version VARCHAR(191) PRIMARY KEY, checksum VARCHAR(64) NOT NULL,
                appliedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin');
            $path = dirname(APPPATH).'/database/migrations/202610230001_offline_sync.sql';
            $version = basename($path, '.sql');
            // Include this PHP implementation in the upgrade fingerprint as it owns ALTERs.
            $checksum = hash('sha256', file_get_contents($path).file_get_contents(__FILE__));
            $statement = $this->connection->prepare('SELECT checksum FROM PpmsSchemaMigration WHERE version=?');
            $statement->bind_param('s', $version);
            $statement->execute();
            $applied = $statement->get_result()->fetch_assoc();
            if ($applied) {
                if (!hash_equals($applied['checksum'], $checksum)) {
                    throw new RuntimeException('Applied migration checksum differs; restore the original migration.');
                }
            } else {
                $this->connection->multi_query(file_get_contents($path));
                do {
                    $result = $this->connection->store_result();
                    if ($result instanceof mysqli_result) { $result->free(); }
                    if (!$this->connection->more_results()) { break; }
                    $this->connection->next_result();
                } while (TRUE);
                foreach (array('canView' => 1, 'canCreate' => 1, 'canEdit' => 1, 'canPublish' => 0) as $column => $default) {
                    $this->column('PersonnelPpmAssignment', $column, 'TINYINT(1) NOT NULL DEFAULT '.$default.' CHECK (`'.$column.'` IN (0,1))');
                }
                foreach (array('SyncMutationReceipt', 'AuditLog') as $table) {
                    $this->column($table, 'ppmFormId', 'VARCHAR(191) NULL REFERENCES PpmForm(id)');
                    $this->column($table, 'batchId', 'VARCHAR(191) NULL REFERENCES SyncDailyBatch(id)');
                    $this->foreign($table, 'ppmFormId', 'PpmForm');
                    $this->foreign($table, 'batchId', 'SyncDailyBatch');
                }
                $this->column('SyncMutationReceipt', 'leaseVersion', 'INT NULL');
                $this->column('AuditLog', 'baseRevisionNo', 'INT NULL');
                $this->column('PpmTemplateVersion', 'activePpmFormId',
                    'VARCHAR(191) GENERATED ALWAYS AS (CASE WHEN isActive=1 THEN ppmFormId ELSE NULL END) STORED');
                $this->index('PpmTemplateVersion', 'uq_active_template_form', 'UNIQUE', '`activePpmFormId`');
                $this->index('SyncMutationReceipt', 'idx_receipt_batch', '', '`batchId`');
                // Preserve legacy ownership data; the old user uniqueness is no longer used.
                $legacy = $this->connection->query("SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='PpmFormWriterLease'");
                if ($legacy->num_rows) {
                    $this->connection->query('INSERT IGNORE INTO PpmFormDeviceLease
                        (ppmFormId,deviceId,leaseVersion,assignedAt,revokedAt,updatedAt)
                        SELECT ppmFormId,deviceId,leaseVersion,assignedAt,revokedAt,updatedAt FROM PpmFormWriterLease');
                }
                $statement = $this->connection->prepare('INSERT INTO PpmsSchemaMigration (version,checksum) VALUES (?,?)');
                $statement->bind_param('ss', $version, $checksum);
                $statement->execute();
            }
            return array('status' => 'migrated', 'version' => $version);
        } finally {
            $statement = $this->connection->prepare('SELECT RELEASE_LOCK(?)');
            $statement->bind_param('s', $lock);
            $statement->execute();
        }
    }

    private function column($table, $column, $definition)
    {
        $statement = $this->connection->prepare('SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?');
        $statement->bind_param('ss', $table, $column);
        $statement->execute();
        if (!$statement->get_result()->num_rows) {
            $this->connection->query('ALTER TABLE `'.$table.'` ADD COLUMN `'.$column.'` '.$definition);
        }
    }

    private function foreign($table, $column, $target)
    {
        $name = 'fk_runtime_'.$table.'_'.$column;
        $statement = $this->connection->prepare('SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name=? AND constraint_name=?');
        $statement->bind_param('ss', $table, $name);
        $statement->execute();
        if (!$statement->get_result()->num_rows) {
            $this->connection->query('ALTER TABLE `'.$table.'` ADD CONSTRAINT `'.$name.'` FOREIGN KEY (`'.$column.'`) REFERENCES `'.$target.'`(id) ON DELETE RESTRICT');
        }
    }

    private function index($table, $name, $type, $columns)
    {
        $statement = $this->connection->prepare('SELECT 1 FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?');
        $statement->bind_param('ss', $table, $name);
        $statement->execute();
        if (!$statement->get_result()->num_rows) {
            $this->connection->query('CREATE '.$type.' INDEX `'.$name.'` ON `'.$table.'` ('.$columns.')');
        }
    }
}
