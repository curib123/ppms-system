const option = (value, label = value) => ({ value, label });

const stockReleaseDefinition = {
  schemaVersion: 1,
  title: 'Warehouse Records - Stock Releasing Form',
  description:
    'Controlled WR-001 stock releases connected directly to exact approved Packing outputs.',
  sections: [
    {
      key: 'monitoringEntries',
      label: 'Stock Releasing Entries',
      description:
        'Add every customer stock release completed for this warehouse record.',
      columns: 1,
      items: [
        {
          key: 'releaseEntries',
          label: 'Release Entries',
          type: 'repeatable',
          required: true,
          minRows: 1,
          maxRows: 200,
          fields: [
            {
              key: 'customerName',
              label: 'Name of Customer',
              type: 'text',
              required: true,
              validation: { maxLength: 256 },
            },
            {
              key: 'productSize',
              label: 'Product Size',
              type: 'text',
              required: true,
              validation: { maxLength: 128 },
            },
            {
              key: 'quantity',
              label: 'Qty',
              type: 'number',
              required: true,
              validation: { min: 0.000001, max: 999999999, step: 0.001 },
            },
            {
              key: 'uom',
              label: 'UOM',
              type: 'select',
              required: true,
              options: [
                option('PACK'),
                option('BOX'),
                option('CASE'),
                option('BAG'),
                option('KG'),
              ],
            },
            {
              key: 'productionDate',
              label: 'Production Date',
              type: 'date',
              required: true,
            },
            {
              key: 'consumeBeforeDate',
              label: 'Consume Before Date',
              type: 'trace-code',
              required: true,
              readOnly: true,
              placeholder: 'Select the Packing Consume Before Code...',
              helpText:
                'Connected directly to the matching Consume Before Code from Packing PPM.',
            },
            {
              key: 'timeReleased',
              label: 'Time Released',
              type: 'time',
              required: true,
            },
            {
              key: 'poNumber',
              label: 'P.O No.',
              type: 'text',
              required: true,
              validation: { maxLength: 128 },
            },
            {
              key: 'receiptNumber',
              label: 'Receipt No.',
              type: 'text',
              required: true,
              validation: { maxLength: 128 },
            },
            {
              key: 'vehicleType',
              label: 'Vehicle Type',
              type: 'select',
              required: true,
              options: [option('CLOSE', 'Close'), option('OPEN', 'Open')],
            },
            {
              key: 'shipmentType',
              label: 'Shipment Type',
              type: 'select',
              required: true,
              options: [
                option('DELIVERY', 'Delivery'),
                option('PICK_UP', 'Pick-up'),
              ],
            },
            {
              key: 'driver',
              label: 'Driver',
              type: 'text',
              required: true,
              validation: { maxLength: 256 },
            },
            {
              key: 'vehiclePlateNumber',
              label: 'Vehicle Plate No.',
              type: 'text',
              required: true,
              validation: { minLength: 2, maxLength: 64 },
            },
          ],
        },
      ],
    },
  ],
};

export const warehouseControlledForms = [
  {
    ppmCode: 'WH-STOCK-RELEASE',
    areaCode: 'WAREHOUSE',
    versionNo: 3,
    versionLabel: 'WR-001_REV_001_FIELDS_ALIGNED',
    effectiveFrom: '2026-07-03',
    sourceFileName: 'Warehouse Records - stock Releasing Form.xlsx',
    documentNumber: 'WR-001',
    revisionNumber: '001',
    definition: stockReleaseDefinition,
    rules: [],
  },
];

const packingCodes = ['PPM-017', 'PPM-018'];
export const warehouseConnections = packingCodes.map((sourcePpm) => ({
  sourcePpm,
  sourceOutputKey: 'consumeBeforeCode',
  targetPpm: 'WH-STOCK-RELEASE',
  targetInputKey: 'releaseEntries[].consumeBeforeDate',
  connectionName: `WAREHOUSE-${sourcePpm}-STOCK-RELEASE`,
  notes: 'Exact governed Packing output selection for Stock Releasing Form.',
}));
