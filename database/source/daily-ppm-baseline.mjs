const text = (key, label, extra = {}) => ({
  key,
  label,
  type: 'text',
  required: true,
  sourceLabel: label,
  ...extra,
});
const number = (key, label, unit, extra = {}) =>
  text(key, label, {
    type: 'number',
    ...(unit ? { unit } : {}),
    validation: { min: 0, step: 0.001 },
    ...extra,
  });
const integer = (key, label, unit, extra = {}) =>
  text(key, label, {
    type: 'integer',
    ...(unit ? { unit } : {}),
    validation: { min: 0 },
    ...extra,
  });
const date = (key, label, extra = {}) =>
  text(key, label, { type: 'date', ...extra });
const time = (key, label, extra = {}) =>
  text(key, label, { type: 'time', ...extra });
const trace = (key, label, extra = {}) =>
  text(key, label, {
    type: 'trace-code',
    helpText:
      'Select the exact published source record after saving the daily draft.',
    ...extra,
  });
const optional = (field) => ({ ...field, required: false });
const generated = (key, label) =>
  text(key, label, {
    readOnly: false,
    helpText:
      'Enter the code printed or recorded on the controlled paper form. The approved pattern is guidance only.',
  });
const internalGenerated = (key, label) =>
  optional(
    text(key, label, {
      readOnly: true,
      helpText: 'Internal PPMS reference; this is not a production code.',
    }),
  );
const option = (value, label = value) => ({ value, label });
const select = (key, label, values, extra = {}) =>
  text(key, label, {
    type: 'select',
    options: values.map((value) =>
      Array.isArray(value) ? option(value[0], value[1]) : option(value),
    ),
    ...extra,
  });
const namedPersonnel = (prefix, label, count) =>
  Array.from({ length: count }, (_, index) =>
    optional(text(`${prefix}${index + 1}`, `${label} ${index + 1}`)),
  );

// Canonical source register extracted from the supplied DOCX files. Keeping
// this beside the digital definitions makes every active template auditable
// back to its exact controlled paper form instead of a generic seed label.
const formSources = {
  'PPM-001': [
    '1. Production Process Monitoring - Egg Preparation- Eggwhites.docx',
    '004',
    '2021-05-01',
    '146D8E99AA9DF2F83A1B126C68A501653E7C3BDEF5205EC6148F3B0E0D38A5A9',
  ],
  'PPM-002': [
    '2. Production Process Monitoring - Eggwhites.docx',
    '003',
    '2021-05-01',
    '39719ED44E8B8BEA5386EF3B74BE4B42643AE47EAAB92795A310ED26B8C6AD04',
  ],
  'PPM-003': [
    '3. Production Process Monitoring - Eggyolk.docx',
    '004',
    '2021-05-01',
    'C97D4B00BA4C47F7011EE84408B8888FBEE69F0CCD6E7D9ACAA987C8C87365F5',
  ],
  'PPM-004': [
    '4. Production Process Monitoring - Peanut Sorting (Raw) (1).docx',
    '004',
    '2021-05-01',
    '7AA3DCED690D529EC0FD5073B797BEC579CBFC236F4D059E3BC35BAC048F938F',
  ],
  'PPM-005': [
    '5. Production Process Monitoring - Peanut Blanching.docx',
    '004',
    '2021-05-01',
    '130C8953D14061BFFA8F6CC23EF3C647FA6C055CED1D20C10C4E716D19C96AA6',
  ],
  'PPM-006': [
    '6. Production Process Monitoring - Peanut Sorting (Pre-roasted).docx',
    '004',
    '2021-05-01',
    '43CE7CA5FC3F102F2345C47597A95904BA10378AB5026128BC563C5443E66CE1',
  ],
  'PPM-007': [
    '7. Production Process Monitoring - Peanut Final Roasting.docx',
    '004',
    '2021-05-01',
    'DF77253E114758766DC456201E0933EF4FE6AE1D9E4A97C69ACA84E9CEA8AFDE',
  ],
  'PPM-008': [
    '8. Production Process Monitoring - Peanut Grinding.docx',
    '004',
    '2021-05-01',
    'CAD995C40FA2CF17E384B1D07BB306481DEAD6B14B90482A4B9D65FEE5D77573',
  ],
  'PPM-009': [
    '9. Production Process Monitoring - Ground Peanuts.docx',
    '003',
    '2021-05-01',
    '808179AC7B528521A55523EE2C731B9AE45C389A6CA8EB86C04E6E77B19AB7A3',
  ],
  'PPM-010': [
    '10. Production Process Monitoring - Sugar.docx',
    '005',
    '2024-06-05',
    '02DB666EF848766BE8ED7B9A0575E0428388D0951973E29695837F69618C3BFC',
  ],
  'PPM-011': [
    '11. Production Process Monitoring - Mixing - Meringue.docx',
    '005',
    '2021-05-01',
    'EAD91C20CB55DC7B48AC7CD410A3FCCD8117E73317760BD1A38C20944E466670',
  ],
  'PPM-012': [
    '12. Production Process Monitoring - Forming.docx',
    '006',
    '2021-06-28',
    '832B59BB707E27EE0C8379FEB676062467F0004A447E9169A771A14D4CCE43C9',
  ],
  'PPM-013': [
    '13. Production Process Monitoring - Baking.docx',
    '004',
    '2021-05-01',
    'F502488F3642267172BC072E9E1A93D01F0D6488CA1A8EE44BCA16AF3C14C545',
  ],
  'PPM-014': [
    '14. Production Process Monitoring - Baked Receiving.docx',
    '004',
    '2021-05-01',
    '0524B19D726410B15D81D1DD4E0A43CBFF889DC64B20FF7A5627750942EBBA1E',
  ],
  'PPM-015': [
    '15. Production Process Monitoring - Primary Packing.docx',
    '004',
    '2021-06-28',
    'BD5C1EF4C4C24AB59B2E748D18DEE03CB322C8C6CBE8822FE2F52F5A2B4C602A',
  ],
  'PPM-016': [
    '16. Production Process Monitoring - Primary Packing2.docx',
    '005',
    '2021-06-28',
    '64BFD538CBB17D7138CB97CCCB6BC535CB6171D315136FC659D318260BB4704F',
  ],
  'PPM-017': [
    '17. Production Process Monitoring - Secondary Packing.docx',
    '003',
    '2021-05-01',
    '7218EA449F76F28CFF0287672EC4E2F21770F9D96F465F4FB4AE4FB9543DE5AF',
  ],
  'PPM-018': [
    '18. Production Process Monitoring - Tertiary Packing.docx',
    '003',
    '2021-05-01',
    '75CE09B26ADD1AEBC6A4C3B268B9C3DCA8CFF507C6CEC4D7A23F2A43C3ECA8CC',
  ],
  'PPM-019': [
    '19. Production Process Monitoring - Vanilla.docx',
    '002',
    '2021-05-01',
    '87A788084D5F62E2AE3D487B4BA014CE29084C8298F1156AC243D67DE1D3717D',
  ],
  'PPM-020': [
    '20. Production Process Monitoring - Frozen Eggyolk - Revised.docx',
    '003',
    '2026-01-27',
    '94253CC5598B9A285974908977133749AE93A90B259C3E015FEDE7018E2FCB24',
  ],
  'PPM-021': [
    '21. Production Process Monitoring - Raw Peanut Receiving.docx',
    '002',
    '2021-05-01',
    'E46ECEC623A1C879DAA4C56EE3C1082DD25110B52438DA378A2560A2EE69ADB6',
  ],
  'PPM-022': [
    '22. Production Process Monitoring - Pan Greaser.docx',
    '001',
    '2026-01-27',
    'EB9D9D41E11925E882A96C94A2C1F7708F710E16BF1DF7A01BF815F92C809E16',
  ],
  'PPM-023': [
    '23. Production Process Monitoring - Forming - Attendance.docx',
    '002',
    '2026-01-27',
    'C3B690D423709B74E94EEF0A6B43A838E9A3E2901ECBCB6CE16491F44E8559EB',
  ],
  'PPM-024': [
    '24. Production Process Monitoring - Product Coding.docx',
    '000',
    '2023-06-20',
    '44E73AE652E1101E5E2FA3FE7B4DB8362C18CB79323B2091824EAFCAAFE1A719',
  ],
  'PPM-026': [
    '26. Production Process Monitoring - Sugar Receiving.docx',
    '000',
    '2024-06-05',
    'A12C09EFD52AB5F0151C30CCE3DDA67D71E9AAB6422760A2A0EEE650696C219D',
  ],
};

const specs = {
  'PPM-001': {
    header: [
      optional(integer('wholeEggsDelivered', 'Whole Eggs - Delivered', 'pcs')),
      optional(integer('wholeEggsAccepted', 'Whole Eggs - Accepted', 'pcs')),
      optional(
        integer('wholeEggsDamaged', 'Whole Eggs - Damaged / Wastage', 'pcs'),
      ),
      optional(integer('crackedEggs', 'Whole Eggs - Cracked', 'pcs')),
      optional(text('wholeEggsRemarks', 'Whole Eggs - Remarks')),
      ...namedPersonnel('eggBreaker', 'Egg Breaker', 8),
    ],
    entries: [
      date('deliveryDate', 'Egg Delivery Date'),
      time('timeStarted', 'Time Started'),
      time('timeEnded', 'Time Ended'),
      integer('eggsBroken', 'Eggs Broke', 'pcs'),
      number('eggwhiteQuantity', 'Eggwhites', 'kg'),
      integer('pailNumber', 'Pail No.'),
      generated('eggwhiteProductionCode', 'Pail Production Code'),
      integer('pitcherNumber', 'Pitcher No.'),
      generated('pitcherProductionCode', 'Pitcher Production Code'),
      time('transferTime', 'Time Transferred to WIC'),
      number('wicTemperature', 'WIC Temperature', '°C'),
      number('damagedWastage', 'Damaged / Wastage', 'kg'),
      number('eggYolkQuantity', 'Eggyolk', 'kg'),
      generated('eggyolkProductionCode', 'Eggyolk Production Code'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      integer('endingWholeEggs', 'Ending Whole Eggs', 'pcs'),
      number('totalEggwhitesProduced', 'Total Eggwhites Produced', 'kg'),
      number('totalEggyolksProduced', 'Total Eggyolks Produced', 'kg'),
      number('totalWastage', 'Total Damaged / Wastage', 'kg'),
      optional(integer('totalEggsBroken', 'Total Eggs - Broke', 'pcs')),
      optional(
        integer('totalPersonnel', 'Total Number of Personnel', 'personnel'),
      ),
      optional(number('totalOperatingTime', 'Total Operating Time', 'hours')),
    ],
    outputs: [
      'eggwhiteProductionCode',
      'pitcherProductionCode',
      'eggyolkProductionCode',
    ],
  },
  'PPM-002': {
    entries: [
      date('productionDate', 'Production Date'),
      number('quantity', 'Eggwhite Quantity', 'kg'),
      integer('pailNumber', 'Pail No.'),
      integer('pitcherNumber', 'Pitcher No.'),
      time('timeReceived', 'Time Received'),
      number('storageTemperature', 'RIC / WIC Temperature', '°C'),
      trace('pailCode', 'Pail Code'),
      trace('pitcherCode', 'Pitcher Code'),
      text('receivedBy', 'Received By'),
      optional(text('releasedBy', 'Released By')),
      optional(text('withdrawnBy', 'Withdrawn By')),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('totalReceived', 'Total Eggwhites Received', 'kg'),
      number('totalReleased', 'Total Eggwhites Released', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
    ],
    outputs: ['pailCode', 'pitcherCode'],
  },
  'PPM-003': {
    entries: [
      date('productionDate', 'Production Date'),
      number('quantity', 'Eggyolk Quantity', 'kg'),
      text('containerNumber', 'Container / Pail No.'),
      time('transferTime', 'Transfer Time'),
      optional(number('ricTemperature', 'RIC Temperature', '°C')),
      optional(number('wicTemperature', 'WIC Temperature', '°C')),
      optional(
        number('chestFreezerTemperature', 'Chest Freezer Temperature', '°C'),
      ),
      optional(number('chilledQuantity', 'Chilled Quantity', 'kg')),
      optional(number('frozenQuantity', 'Frozen Quantity', 'kg')),
      optional(text('chilled', 'Chilled')),
      optional(text('frozen', 'Frozen')),
      optional(text('customer', 'Customer')),
      optional(text('salesDocumentNumber', 'SI / OR / DR / SD No.')),
      number('storageTemperature', 'Storage Temperature', '°C'),
      trace('eggyolkCode', 'Eggyolk Code'),
      text('receivedBy', 'Received By'),
      optional(text('releasedBy', 'Released By')),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('totalReceived', 'Total Eggyolk Received', 'kg'),
      number('totalReleased', 'Total Eggyolk Released', 'kg'),
      number('wastage', 'Wastage', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
    ],
    outputs: ['eggyolkCode'],
  },
  'PPM-004': {
    entries: [
      trace('rawReceivingReference', 'Raw Peanut Receiving Record'),
      date('deliveryDate', 'Delivery Date'),
      select('sourceType', 'Source', [
        ['L', 'Local'],
        ['I', 'Imported'],
      ]),
      text('supplierSurname', 'Supplier Surname'),
      text('supplier', 'Supplier'),
      text('sackNumber', 'Sack No.'),
      number('quantityReceived', 'Quantity Received', 'kg'),
      number('sortedQuantity', 'Sorted Quantity', 'kg'),
      number('rejects', 'Rejected / Foreign Materials', 'kg'),
      optional(time('timeStarted', 'Time Started')),
      optional(time('timeEnded', 'Time Ended')),
      optional(number('moistureContent', 'Moisture Content', '%')),
      optional(number('roomHumidity', 'Room Humidity', '% RH')),
      generated('sortingCode', 'Sorting Code'),
      text('sortedBy', 'Sorted By'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('totalReceived', 'Total Received', 'kg'),
      number('totalSorted', 'Total Sorted', 'kg'),
      number('totalRejected', 'Total Rejected', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
      optional(
        number('endingSelectedInventory', 'Ending Inventory Selected', 'kg'),
      ),
      optional(
        number(
          'endingUnselectedInventory',
          'Ending Inventory Unselected',
          'kg',
        ),
      ),
    ],
    outputs: ['sortingCode'],
  },
  'PPM-005': {
    entries: [
      trace('sortingCode', 'Sorting Code'),
      date('deliveryDate', 'Delivery Date'),
      select('sourceType', 'Source', [
        ['L', 'Local'],
        ['I', 'Imported'],
      ]),
      text('supplierSurname', 'Supplier Surname'),
      time('timeStarted', 'Time Started'),
      time('timeEnded', 'Time Ended'),
      number('quantityReceived', 'Quantity Received', 'kg'),
      number('blanchedQuantity', 'Blanched Quantity', 'kg'),
      number('wastage', 'Wastage', 'kg'),
      number('temperature', 'Blanching Temperature', '°C'),
      generated('blanchingCode', 'Blanching Code'),
      text('operator', 'Operator'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('totalReceived', 'Total Received', 'kg'),
      number('totalBlanched', 'Total Blanched', 'kg'),
      number('totalWastage', 'Total Wastage', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
      optional(number('totalOperatingTime', 'Total Operating Time', 'hours')),
    ],
    outputs: ['blanchingCode'],
  },
  'PPM-006': {
    entries: [
      trace('blanchingCode', 'Blanching Code'),
      date('deliveryDate', 'Delivery Date'),
      select('sourceType', 'Source', [
        ['L', 'Local'],
        ['I', 'Imported'],
      ]),
      text('supplierSurname', 'Supplier Surname'),
      time('timeStarted', 'Time Started'),
      time('timeEnded', 'Time Ended'),
      number('quantityReceived', 'Quantity Received', 'kg'),
      number('sortedQuantity', 'Sorted Quantity', 'kg'),
      number('rejects', 'Rejected Peanuts', 'kg'),
      generated('finalSortingCode', 'Final Sorting Code'),
      ...namedPersonnel('sorter', 'Sorter', 14),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('totalReceived', 'Total Received', 'kg'),
      number('totalSorted', 'Total Sorted', 'kg'),
      number('totalRejected', 'Total Rejected', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
    ],
    outputs: ['finalSortingCode'],
  },
  'PPM-007': {
    entries: [
      trace('sortingCode', 'Sorting Code'),
      date('deliveryDate', 'Delivery Date'),
      select('sourceType', 'Source', [
        ['L', 'Local'],
        ['I', 'Imported'],
      ]),
      text('supplierSurname', 'Supplier Surname'),
      time('timeStarted', 'Roasting Time Started'),
      time('timeEnded', 'Roasting Time Ended'),
      number('quantityReceived', 'Quantity Received', 'kg'),
      number('roastedQuantity', 'Roasted Quantity', 'kg'),
      number('roastingTemperature', 'Roasting Temperature', '°C'),
      number('wastage', 'Wastage', 'kg'),
      generated('finalRoastingCode', 'Final Roasting Code'),
      text('operator', 'Operator'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('totalReceived', 'Total Received', 'kg'),
      number('totalRoasted', 'Total Roasted', 'kg'),
      number('totalWastage', 'Total Wastage', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
      optional(
        number('endingSortedInventory', 'Ending Inventory - Sorted', 'kg'),
      ),
      optional(
        number('endingRoastedInventory', 'Ending Inventory - Roasted', 'kg'),
      ),
      optional(number('totalOperatingTime', 'Total Operating Time', 'hours')),
    ],
    outputs: ['finalRoastingCode'],
  },
  'PPM-008': {
    entries: [
      trace('finalRoastingCode', 'Final Roasting Code'),
      date('deliveryDate', 'Delivery Date'),
      select('sourceType', 'Source', [
        ['L', 'Local'],
        ['I', 'Imported'],
      ]),
      text('supplierSurname', 'Supplier Surname'),
      time('timeStarted', 'Grinding Time Started'),
      time('timeEnded', 'Grinding Time Ended'),
      number('quantityReceived', 'Quantity Received', 'kg'),
      number('groundQuantity', 'Ground Quantity', 'kg'),
      number('wastage', 'Wastage', 'kg'),
      generated('grindingCode', 'Grinding Code'),
      text('operator', 'Operator'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('totalReceived', 'Total Received', 'kg'),
      number('totalGround', 'Total Ground', 'kg'),
      number('totalWastage', 'Total Wastage', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
      optional(
        number('endingRoastedInventory', 'Ending Inventory - Roasted', 'kg'),
      ),
      optional(
        number('endingGroundInventory', 'Ending Inventory - Ground', 'kg'),
      ),
      optional(number('totalRejected', 'Total Quantity Rejected', 'kg')),
      optional(number('totalTime', 'Total Time', 'hours')),
    ],
    outputs: ['grindingCode'],
  },
  'PPM-009': {
    entries: [
      trace('grindingCode', 'Grinding Code'),
      date('productionDate', 'Production Date'),
      number('quantityReceived', 'Quantity Received', 'kg'),
      number('quantityReleased', 'Quantity Released', 'kg'),
      text('releasedBy', 'Released By'),
      text('receivedBy', 'Received By'),
      optional(text('withdrawnBy', 'Withdrawn By')),
      optional(time('releaseTime', 'Time')),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('beginningInventory', 'Beginning Inventory', 'kg'),
      number('totalReceived', 'Total Received', 'kg'),
      number('totalReleased', 'Total Released', 'kg'),
      number('wastage', 'Wastage', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
    ],
    outputs: ['grindingCode'],
  },
  'PPM-010': {
    entries: [
      trace('sugarReceivingCode', 'Sugar Receiving Reference'),
      date('deliveryDate', 'Delivery Date'),
      text('supplierSurname', 'Supplier Surname'),
      number('quantity', 'Quantity', 'kg'),
      optional(integer('sacks', 'Quantity / Sacks', 'sack')),
      number('withdrawal', 'Withdrawal', 'kg'),
      text('releasedBy', 'Released By'),
      text('withdrawnBy', 'Withdrawn By'),
      text('siftedBy', 'Sifted By'),
      optional(text('personInCharge', 'PIC')),
      optional(time('transactionTime', 'Time')),
      generated('sugarCode', 'Sugar Code'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('totalArrival', 'Total Arrival', 'kg'),
      number('totalWithdrawal', 'Total Withdrawal', 'kg'),
      number('totalUsage', 'Total Usage', 'kg'),
      number('wastage', 'Wastage', 'kg'),
      number('unsiftedEndingInventory', 'Unsifted Ending Inventory', 'kg'),
      number('siftedEndingInventory', 'Sifted Ending Inventory', 'kg'),
    ],
    outputs: ['sugarCode'],
  },
  'PPM-011': {
    customSections: [
      {
        key: 'meringueEntries',
        label: 'Meringue entries',
        type: 'repeatable',
        required: true,
        minRows: 1,
        maxRows: 100,
        fields: [
          text('mixingNumber', 'Mixing No.'),
          time('timeStarted', 'Time Started'),
          number('eggwhiteQuantity', 'Eggwhites Quantity', 'kg'),
          trace('eggwhiteCode', 'Eggwhites Code'),
          number('eggwhiteTemperature', 'Eggwhites Temperature', '°C'),
          integer('pailNumber', 'Pail No.'),
          integer('pitcherNumber', 'Pitcher No.'),
          number('sugarQuantity', 'Sugar Quantity', 'kg'),
          trace('sugarCode', 'Sugar Code'),
          number('vanillaQuantity', 'Vanilla Quantity', 'kg'),
          trace('vanillaCode', 'Vanilla Code'),
          number('specificGravityPreMix', 'Specific Gravity - Pre-Mix'),
          number(
            'coolingMachineTemperature',
            'Cooling Machine Temperature',
            '°C',
          ),
          number('specificGravityMeringue', 'Specific Gravity - Meringue'),
          time('timeEnded', 'Time Ended'),
          text('operator', 'Operator'),
          number('weight', 'Weight', 'kg'),
          time('transferTime', 'Time Transferred to Scaling Room'),
          generated('meringueCode', 'Meringue Code'),
        ],
      },
      {
        key: 'mixtureEntries',
        label: 'Mixture entries',
        type: 'repeatable',
        required: true,
        minRows: 1,
        maxRows: 100,
        fields: [
          text('batchNumber', 'Batch No.'),
          time('timeStarted', 'Time Started'),
          number('meringueQuantity', 'Meringue Quantity', 'kg'),
          trace('meringueCode', 'Meringue Code'),
          number('totalActualMixture', 'Total Actual Mixture', 'kg'),
          text('mixerNumber', 'Mixer No.'),
          text('operator', 'Operator'),
          time('timeEnded', 'Time Ended'),
          generated('mixingCode', 'Batch Code / Mixing Code'),
        ],
      },
      {
        key: 'groundPeanutLots',
        label: 'Ground Peanut source lots per mixture batch',
        type: 'repeatable',
        required: true,
        minRows: 1,
        maxRows: 300,
        helpText: 'Add one exact linked row for every Ground Peanut lot used.',
        fields: [
          text('mixtureBatchNumber', 'Mixture Batch No.'),
          number('quantity', 'Ground Peanut Quantity', 'kg'),
          trace('groundPeanutCode', 'Ground Peanut / Grinding Code'),
        ],
      },
    ],
    totals: [
      number('totalEggwhiteUsed', 'Total Eggwhite Used', 'kg'),
      number('totalSugarUsed', 'Total Sugar Used', 'kg'),
      number('totalVanillaUsed', 'Total Vanilla Used', 'kg'),
      number('totalGroundPeanutUsed', 'Total Ground Peanut Used', 'kg'),
      number('endingEggwhiteInventory', 'Ending Eggwhite Inventory', 'kg'),
      number('endingSugarInventory', 'Ending Sugar Inventory', 'kg'),
      number('endingVanillaInventory', 'Ending Vanilla Inventory', 'kg'),
    ],
    outputs: ['meringueCode', 'mixingCode'],
  },
  'PPM-012': {
    entries: [
      time('timeReceived', 'Time Received'),
      text('forwardedBy', 'Forwarded By'),
      trace('mixingCode', 'Mixing Code'),
      text('receivedBy', 'Received By'),
      optional(text('inCharge', 'In-charge')),
      text('distribution', 'Distribution'),
      text('moulding', 'Moulding'),
      text('coning', 'Coning'),
      time('distributionTimeStarted', 'Distribution Time Started'),
      time('distributionTimeEnded', 'Distribution Time Ended'),
      time('mouldingTimeStarted', 'Moulding Time Started'),
      time('mouldingTimeEnded', 'Moulding Time Ended'),
      time('coningTimeStarted', 'Coning Time Started'),
      time('coningTimeEnded', 'Coning Time Ended'),
      number('mixtureHoldingTime', 'Mixture Holding Time', 'min'),
      integer('totalPans', 'Total Pans', 'pans'),
      text('groupNumber', 'Group Number'),
      time('timeForwardedToOven', 'Time Forwarded to Oven'),
      internalGenerated(
        'formingSessionReference',
        'Operational Forming Session Reference',
      ),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      integer('operatingTotalPans', 'Operating Total Pans', 'pans'),
      number('totalOperatingTime', 'Total Operating Time', 'min'),
      number('wastage', 'Wastage', 'kg'),
      optional(integer('totalConer', 'Total Coner', 'personnel')),
      optional(integer('totalMoulder', 'Total Moulder', 'personnel')),
      optional(number('totalQuantity', 'Total Qty in Kilos', 'kg')),
    ],
    outputs: ['formingSessionReference'],
  },
  'PPM-013': {
    entries: [
      trace('mixingCode', 'Mixing Code'),
      time('infeedingStart', 'Infeeding Start'),
      time('infeedingEnd', 'Infeeding End'),
      number('ovenZone1Temperature', 'Oven Zone 1 Temperature', '°C'),
      number('ovenZone2Temperature', 'Oven Zone 2 Temperature', '°C'),
      number('ovenZone3Temperature', 'Oven Zone 3 Temperature', '°C'),
      optional(number('ovenZone4Temperature', 'Oven Zone 4 Temperature', '°C')),
      optional(
        number('ovenZone1UpperTemperature', 'Zone 1 Upper Temperature', '°C'),
      ),
      optional(
        number('ovenZone1LowerTemperature', 'Zone 1 Lower Temperature', '°C'),
      ),
      optional(
        number('ovenZone2UpperTemperature', 'Zone 2 Upper Temperature', '°C'),
      ),
      optional(
        number('ovenZone2LowerTemperature', 'Zone 2 Lower Temperature', '°C'),
      ),
      optional(
        number('ovenZone3UpperTemperature', 'Zone 3 Upper Temperature', '°C'),
      ),
      optional(
        number('ovenZone3LowerTemperature', 'Zone 3 Lower Temperature', '°C'),
      ),
      optional(
        number('ovenZone4UpperTemperature', 'Zone 4 Upper Temperature', '°C'),
      ),
      optional(
        number('ovenZone4LowerTemperature', 'Zone 4 Lower Temperature', '°C'),
      ),
      time('outfeedingTime', 'Outfeeding Time'),
      text('feededBy', 'Feeded By'),
      text('ovenman', 'Ovenman'),
      number('totalBaked', 'Total Baked Kilos', 'kg'),
      number('wastage', 'Wastage', 'kg'),
      time('preheatingTime', 'Preheating Time'),
      time('ovenTurnOffTime', 'Oven Turn-off Time'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      integer('dailyTotalBaked', 'Daily Total Baked', 'pans'),
      number('dailyWastage', 'Daily Wastage', 'kg'),
    ],
    outputs: [],
  },
  'PPM-014': {
    entries: [
      text('batchNumber', 'Batch No.'),
      text('receiver', 'Receiver'),
      text('receiverInitials', 'Receiver Initials'),
      number('quantity', 'Quantity', 'kg'),
      trace('mixingCode', 'Mixing Code'),
      generated('bakedCode', 'Baked Code'),
      text('conductedBy', 'Conducted By'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('beginningInventory', 'Beginning Inventory', 'kg'),
      number('totalProduced', 'Total Produced', 'kg'),
      number('wastage', 'Wastage', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
    ],
    outputs: ['bakedCode'],
  },
  'PPM-015': {
    header: [select('size', 'Size', [['20g', '20g']])],
    entries: [
      text('batchNumber', 'Batch Number'),
      trace('bakedCode', 'Baked Code'),
      text('assistant', 'Assistant'),
      number('quantityKilos', 'Quantity - kilos', 'kg'),
      integer('quantityPacks', 'Quantity - packs', 'pack'),
      number('operatingTime', 'Operating Time', 'min'),
      optional(time('timeStarted', 'Time Started')),
      optional(time('timeEnded', 'Time Ended')),
      date('productionDate', 'Production Date'),
      trace('printedFoilRollCode', 'Printed Foil Roll Code'),
      text('printedFoilSupplier', 'Printed Foil Supplier'),
      optional(text('pvcLotNumber', 'PVC Lot No.')),
      optional(text('pvcSupplier', 'PVC Supplier')),
      text('groupNumber', 'Group Number'),
      optional(text('groupA', 'Group A')),
      optional(text('groupB', 'Group B')),
      optional(text('groupC', 'Group C')),
      generated('consumeBeforeCode', 'Consume Before Code'),
      text('conductedBy', 'Conducted By'),
    ],
    totals: [
      number('beginningInventory', 'Beginning Inventory', 'pack'),
      number('withdrawal', 'Withdrawal', 'pack'),
      number('crushed', 'Crushed / Substandard / Overbaked', 'pack'),
      optional(number('totalCrushed', 'Total Crushed', 'pack')),
      optional(number('totalSubstandard', 'Total Substandard', 'pack')),
      number('wastage', 'Wastage', 'pack'),
      number('rejectedPackaging', 'Rejected Packaging', 'pack'),
      optional(number('totalRejectedFoil', 'Total Rejected Foil', 'pack')),
      optional(number('totalRejectedPvc', 'Total Rejected PVC', 'pack')),
      optional(number('totalTime', 'Total Time', 'min')),
      number('totalProduced', 'Total Produced', 'pack'),
      number('endingInventory', 'Ending Inventory', 'pack'),
    ],
    outputs: ['consumeBeforeCode'],
  },
  'PPM-016': {
    header: [select('size', 'Size', [['100g', '100g']])],
    entries: [
      text('batchNumber', 'Batch Number'),
      trace('bakedCode', 'Baked Code'),
      text('assistant', 'Assistant'),
      number('quantityKilos', 'Quantity - kilos', 'kg'),
      integer('quantityPacks', 'Quantity - packs', 'pack'),
      number('operatingTime', 'Operating Time', 'min'),
      optional(time('timeStarted', 'Time Started')),
      optional(time('timeEnded', 'Time Ended')),
      date('productionDate', 'Production Date'),
      trace('plainFoilRollCode', 'Plain Foil Roll Code'),
      text('plainFoilSupplier', 'Plain Foil Supplier'),
      text('groupNumber', 'Group Number'),
      optional(text('groupA', 'Group A')),
      optional(text('groupB', 'Group B')),
      optional(text('groupC', 'Group C')),
      optional(text('teamLeader', 'Team Leader')),
      generated('consumeBeforeCode', 'Consume Before Code'),
      text('conductedBy', 'Conducted By'),
    ],
    totals: [
      number('beginningInventory', 'Beginning Inventory', 'box'),
      number('withdrawal', 'Withdrawal', 'box'),
      number('crushed', 'Crushed / Substandard / Overbaked', 'box'),
      optional(number('totalCrushed', 'Total Crushed', 'box')),
      optional(number('totalOverbaked', 'Total Overbaked', 'box')),
      number('wastage', 'Wastage', 'box'),
      number('rejectedPackaging', 'Rejected Packaging', 'box'),
      optional(number('totalTime', 'Total Time', 'min')),
      number('totalProduced', 'Total Produced', 'box'),
      number('endingInventory', 'Ending Inventory', 'box'),
    ],
    outputs: ['consumeBeforeCode'],
  },
  'PPM-017': {
    entries: [
      trace('consumeBeforeCode', 'Consume Before Code'),
      text('batchNumber', 'Batch Number'),
      trace('packingCode', 'Packing Code'),
      optional(text('particular', 'Particular')),
      number('quantityReceived', 'Quantity Received', 'pack'),
      number('quantityPacked', 'Quantity Packed', 'pack'),
      optional(number('quantityReleased', 'Released', 'pack')),
      optional(time('transactionTime', 'Time')),
      optional(number('operatingTime', 'Operating Time', 'hours')),
      text('packagingMaterial', 'Packaging Material'),
      text('groupNumber', 'Group Number'),
      optional(text('releasedBy', 'Released By')),
      optional(text('withdrawnBy', 'Withdrawn By')),
      optional(text('teamLeader', 'Team Leader')),
      text('conductedBy', 'Conducted By'),
      ...namedPersonnel('personnel', 'Personnel', 12),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('beginningInventory', 'Beginning Inventory', 'pack'),
      number('totalReceived', 'Total Received', 'pack'),
      number('totalPacked', 'Total Packed', 'pack'),
      number('rejects', 'Rejected Packaging', 'pack'),
      number('endingInventory', 'Ending Inventory', 'pack'),
      optional(number('endingSemiInventory', 'Ending - Semi', 'pack')),
      optional(number('totalWithdrawnSemi', 'Total Withdrawn Semi', 'pack')),
      optional(integer('totalManpower', 'Total Manpower', 'personnel')),
      optional(number('beginning100g', '100g Beginning', 'pack')),
      optional(number('produced100g', '100g Produced', 'pack')),
      optional(number('released100g', '100g Released', 'pack')),
      optional(number('ending100g', '100g Ending', 'pack')),
      optional(number('casesPcs100g', '100g Cases / Pcs', 'pack')),
      optional(number('beginning200g', '200g Beginning', 'pack')),
      optional(number('produced200g', '200g Produced', 'pack')),
      optional(number('released200g', '200g Released', 'pack')),
      optional(number('ending200g', '200g Ending', 'pack')),
      optional(number('casesPcs200g', '200g Cases / Pcs', 'pack')),
    ],
    outputs: ['consumeBeforeCode'],
  },
  'PPM-018': {
    header: [
      select('productType', 'Product Type', [
        'Combo 16s',
        '144',
        'CP',
        'Pasabox',
      ]),
    ],
    entries: [
      trace('consumeBeforeCode', 'Consume Before Code'),
      text('batchNumber', 'Batch Number'),
      optional(text('particular', 'Particular')),
      number('quantityReceived', 'Quantity Received', 'case'),
      number('quantityPacked', 'Quantity Packed', 'case'),
      optional(number('quantityReleased', 'Released', 'case')),
      optional(time('transactionTime', 'Time')),
      text('tertiaryMaterial', 'Tertiary Packaging Material'),
      text('groupNumber', 'Group Number'),
      optional(text('withdrawnBy', 'Withdrawn By')),
      optional(text('teamLeader', 'Team Leader')),
      optional(number('productivity', 'Productivity', 'case/hour')),
      text('conductedBy', 'Conducted By'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('beginningInventory', 'Beginning Inventory', 'case'),
      number('totalReceived', 'Total Received', 'case'),
      number('totalPacked', 'Total Packed', 'case'),
      number('rejects', 'Rejected Packaging', 'case'),
      number('endingInventory', 'Ending Inventory', 'case'),
      optional(number('totalWithdrawal', 'Total Withdrawal', 'case')),
      optional(number('totalHours', 'Total Hours', 'hours')),
      optional(integer('totalManpower', 'Total Manpower', 'personnel')),
      optional(number('ending144', 'Ending 144', 'case')),
      optional(number('endingCombo', 'Ending Combo 16s', 'case')),
      optional(number('endingCp', 'Ending CP', 'case')),
      optional(number('endingPasabox', 'Ending Pasabox', 'case')),
    ],
    outputs: ['consumeBeforeCode'],
  },
  'PPM-019': {
    entries: [
      date('arrivalDate', 'Arrival Date'),
      number('quantity', 'Quantity', 'kg'),
      text('uom', 'UOM'),
      text('productCode', 'Product Code'),
      generated('vanillaCode', 'Vanilla Code'),
      date('expiryDate', 'Expiry Date'),
      text('receivedBy', 'Received By'),
      number('releasedQuantity', 'Released Quantity', 'kg'),
      optional(number('usage', 'Usage', 'kg')),
      text('releasedBy', 'Released By'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('totalArrival', 'Total Arrival', 'kg'),
      number('totalReleased', 'Total Released', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
    ],
    outputs: ['vanillaCode'],
  },
  'PPM-020': {
    entries: [
      trace('eggyolkCode', 'Eggyolk Code'),
      trace('sugarCode', 'Sugar Code'),
      number('eggyolkQuantity', 'Eggyolk Quantity', 'kg'),
      number('sugarQuantity', 'Sugar Quantity', 'kg'),
      optional(time('timeStarted', 'Time Started')),
      optional(time('timeEnded', 'Time Ended')),
      optional(text('mixerNumber', 'Mixer No.')),
      optional(text('operator', 'Operator')),
      optional(text('personnelNames', 'Name of Personnel')),
      text('batchNumber', 'Batch Number'),
      generated('frozenEggyolkCode', 'Frozen Eggyolk / Consume Before Code'),
      date('productionDate', 'Production Date'),
      date('consumeBeforeDate', 'Consume Before Date'),
      number('storageTemperature', 'Storage Temperature', '°C'),
      optional(text('packagingSupplier', 'Packaging Supplier')),
      optional(text('tapeColor', 'Tape Color')),
      text('customer', 'Customer / Releasing Information'),
      text('releasedBy', 'Released By'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('totalProduced', 'Total Produced', 'kg'),
      optional(
        number(
          'totalProducedPacks',
          'Total Eggyolk Produced by Pack (2 kilos)',
          'pack',
        ),
      ),
      optional(
        number('totalEggyolkProduced', 'Total Eggyolk Produced in Kilos', 'kg'),
      ),
      optional(number('totalSugarUsed', 'Total Sugar in Kilos', 'kg')),
      number('totalReleased', 'Total Released', 'kg'),
      number('wastage', 'Wastage', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
    ],
    outputs: ['frozenEggyolkCode'],
  },
  'PPM-021': {
    header: [text('supplier', 'Supplier')],
    entries: [
      text('sackNumber', 'Sack No.'),
      number('actualWeight', 'Actual Weight', 'kg'),
      ...namedPersonnel('receivingPersonnel', 'Receiving Personnel', 6),
      internalGenerated(
        'rawReceivingReference',
        'Internal Receiving Entry Reference',
      ),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      integer('totalSacksAccepted', 'Total Sacks Accepted', 'sack'),
      number('totalKilosAccepted', 'Total Kilos Accepted', 'kg'),
      integer('totalSacksRejected', 'Total Sacks Rejected', 'sack'),
      number('totalKilosRejected', 'Total Kilos Rejected', 'kg'),
    ],
    outputs: ['rawReceivingReference'],
  },
  'PPM-022': {
    entries: [
      date('arrivalDate', 'Arrival Date'),
      text('containerNumber', 'Container Number'),
      generated('oilCode', 'Oil Code'),
      number('quantity', 'Quantity', 'kg'),
      date('expiryDate', 'Expiry Date'),
      text('receivedBy', 'Received By'),
      text('batchNumber', 'Batch Number Usage'),
      trace('usageOilCode', 'Usage Oil Code'),
      optional(text('bakingPersonnel', 'Baking Personnel')),
      optional(text('personnel', 'Personnel')),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      number('beginningInventory', 'Beginning Inventory', 'kg'),
      number('arrival', 'Arrival', 'kg'),
      number('usage', 'Usage', 'kg'),
      number('endingInventory', 'Ending Inventory', 'kg'),
    ],
    outputs: ['oilCode'],
  },
  'PPM-023': {
    entries: [
      trace('formingSessionReference', 'Forming Operational Session'),
      text('groupNumber', 'Group Number'),
      text('employeeName', 'Employee Name'),
      optional(text('surname', 'Surname')),
      optional(text('position', 'Position')),
      optional(text('amAssignment', 'AM Assignment')),
      optional(text('pmAssignment', 'PM Assignment')),
      optional(text('assistant', 'Assistant')),
      optional(text('coningAssignment', 'C - Coning')),
      optional(text('mouldingAssignment', 'M - Moulding')),
      time('timeIn', 'Time In'),
      time('timeOut', 'Time Out'),
      text('formingAssignment', 'Forming Assignment'),
      text('teamLeader', 'Team Leader'),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      integer('totalPersonnel', 'Total Personnel', 'personnel'),
      number('totalManHours', 'Total Man Hours', 'hours'),
      optional(number('totalMixing', 'Total Mixing', 'batch')),
      optional(number('totalMixture', 'Total Mixture in Kilos', 'kg')),
    ],
    outputs: [],
  },
  'PPM-024': {
    entries: [
      text('batchNumber', 'Batch No.'),
      trace('bakedCode', 'Baked Code'),
      text('code', 'Code'),
      text('size', 'Size'),
      trace('productCode', 'Product Code'),
      trace('rollCode', 'Roll Code'),
      number('quantityReleased', 'Quantity Released', 'roll'),
      number('misprintedReturn', 'Misprinted Return', 'roll'),
      number('damagedReturn', 'Damaged Return', 'roll'),
      number('additional', 'Additional', 'roll'),
      number('excess', 'Excess', 'roll'),
      number('totalUsed', 'Total Used', 'roll'),
      text('releasedBy', 'Released By'),
      text('receivedBy', 'Received By'),
      optional(text('coder', 'Coder')),
      optional(text('teamLeader', 'Team Leader')),
    ],
    totals: [
      number('dailyQuantityReleased', 'Daily Quantity Released', 'roll'),
      number('dailyTotalUsed', 'Daily Total Used', 'roll'),
      number('dailyReturns', 'Daily Returns', 'roll'),
      optional(number('totalQuantityReleased', 'Total Qty Released', 'roll')),
      optional(
        number('totalQuantityMisprinted', 'Total Qty Misprinted', 'roll'),
      ),
      optional(number('totalQuantityDamaged', 'Total Qty Damaged', 'roll')),
      optional(number('totalQuantityExcess', 'Total Qty Excess', 'roll')),
    ],
    outputs: ['productCode', 'rollCode'],
  },
  'PPM-026': {
    header: [text('supplier', 'Supplier'), text('brand', 'Brand')],
    entries: [
      text('sackNumber', 'Sack No.'),
      number('actualWeight', 'Actual Weight', 'kg'),
      ...namedPersonnel('receivingPersonnel', 'Receiving Personnel', 6),
      internalGenerated(
        'sugarReceivingCode',
        'Internal Sugar Receiving Entry Reference',
      ),
      optional(text('remarks', 'Remarks')),
    ],
    totals: [
      integer('totalSacksAccepted', 'Total Sacks Accepted', 'sack'),
      number('totalKilosAccepted', 'Total Kilos Accepted', 'kg'),
      integer('totalSacksRejected', 'Total Sacks Rejected', 'sack'),
      number('totalKilosRejected', 'Total Kilos Rejected', 'kg'),
    ],
    outputs: ['sugarReceivingCode'],
  },
};

function definition(ppmCode, title, spec) {
  const sections = [];
  if (spec.header?.length)
    sections.push({
      key: 'dailyContext',
      label: 'Daily Context',
      columns: 2,
      items: spec.header,
    });
  sections.push({
    key: 'monitoringEntries',
    label: 'Monitoring Entries',
    description:
      'One daily record contains every transaction or production run for this monitoring date.',
    columns: 1,
    items: spec.customSections ?? [
      {
        key: 'entries',
        label: 'Daily Data Entries',
        type: 'repeatable',
        required: true,
        minRows: 1,
        maxRows: 200,
        fields: spec.entries,
      },
    ],
  });
  sections.push({
    key: 'dailyTotals',
    label: 'Daily Totals and Inventory',
    columns: 3,
    items: spec.totals.map(optional),
  });
  return {
    schemaVersion: 1,
    title: `${ppmCode} - ${title}`,
    description:
      'Controlled digital daily-monitoring equivalent of the supplied PPM form.',
    sections,
  };
}

const generatedRule = (
  outputKey,
  outputLabel,
  outputPath,
  formulaTemplate,
  bindings,
  extra = {},
) => {
  const internal = String(extra.outputType ?? '').startsWith('INTERNAL_');
  return {
    outputKey,
    outputLabel,
    sourceType: internal ? 'SYSTEM_GENERATED' : 'MANUAL_EXTERNAL',
    formulaTemplate,
    requiresUniqueBusinessCode: true,
    configurationJson: {
      outputPath,
      outputType: extra.outputType ?? 'PPM_GENERATED_CODE',
      ...(extra.quantityPath ? { quantityPath: extra.quantityPath } : {}),
      ...(extra.unit ? { unit: extra.unit } : {}),
      bindings,
      ...(!internal
        ? { guidePattern: formulaTemplate, validationOnly: true }
        : {}),
    },
  };
};

const generatedRules = {
  'PPM-001': [
    generatedRule(
      'eggwhiteProductionCode',
      'Eggwhite Production Code',
      'entries[].eggwhiteProductionCode',
      '{{delivery}}{{quantity}}{{production}}',
      {
        delivery: { path: 'entries[].deliveryDate', format: 'DDMMYY' },
        quantity: 'entries[].eggwhiteQuantity',
        production: {
          source: 'RECORD',
          path: 'productionDate',
          format: 'DDMMYY',
        },
      },
      { quantityPath: 'entries[].eggwhiteQuantity', unit: 'kg' },
    ),
    generatedRule(
      'eggyolkProductionCode',
      'Eggyolk Production Code',
      'entries[].eggyolkProductionCode',
      '{{delivery}}{{quantity}}{{production}}',
      {
        delivery: { path: 'entries[].deliveryDate', format: 'DDMMYY' },
        quantity: 'entries[].eggYolkQuantity',
        production: {
          source: 'RECORD',
          path: 'productionDate',
          format: 'DDMMYY',
        },
      },
      { quantityPath: 'entries[].eggYolkQuantity', unit: 'kg' },
    ),
    generatedRule(
      'pitcherProductionCode',
      'Pitcher Production Code',
      'entries[].pitcherProductionCode',
      '{{delivery}}{{quantity}}{{production}}',
      {
        delivery: { path: 'entries[].deliveryDate', format: 'DDMMYY' },
        quantity: 'entries[].eggwhiteQuantity',
        production: {
          source: 'RECORD',
          path: 'productionDate',
          format: 'DDMMYY',
        },
      },
      { quantityPath: 'entries[].eggwhiteQuantity', unit: 'kg' },
    ),
  ],
  'PPM-004': [
    generatedRule(
      'sortingCode',
      'Sorting Code',
      'entries[].sortingCode',
      '{{delivery}}{{source}}{{supplier}}{{production}}-{{quantity}}-R',
      {
        delivery: { path: 'entries[].deliveryDate', format: 'DDMMYY' },
        source: { path: 'entries[].sourceType', format: 'UPPERCASE' },
        supplier: { path: 'entries[].supplierSurname', format: 'INITIAL' },
        production: {
          source: 'RECORD',
          path: 'productionDate',
          format: 'DDMMYY',
        },
        quantity: 'entries[].sortedQuantity',
      },
      { quantityPath: 'entries[].sortedQuantity', unit: 'kg' },
    ),
  ],
  'PPM-007': [
    generatedRule(
      'finalRoastingCode',
      'Final Roasting Code',
      'entries[].finalRoastingCode',
      '{{delivery}}{{source}}{{supplier}}{{production}}-{{quantity}}-FR',
      {
        delivery: { path: 'entries[].deliveryDate', format: 'DDMMYY' },
        source: { path: 'entries[].sourceType', format: 'UPPERCASE' },
        supplier: { path: 'entries[].supplierSurname', format: 'INITIAL' },
        production: {
          source: 'RECORD',
          path: 'productionDate',
          format: 'DDMMYY',
        },
        quantity: 'entries[].roastedQuantity',
      },
      { quantityPath: 'entries[].roastedQuantity', unit: 'kg' },
    ),
  ],
  'PPM-008': [
    generatedRule(
      'grindingCode',
      'Grinding Code',
      'entries[].grindingCode',
      '{{delivery}}{{source}}{{supplier}}{{production}}-{{quantity}}-G',
      {
        delivery: { path: 'entries[].deliveryDate', format: 'DDMMYY' },
        source: { path: 'entries[].sourceType', format: 'UPPERCASE' },
        supplier: { path: 'entries[].supplierSurname', format: 'INITIAL' },
        production: {
          source: 'RECORD',
          path: 'productionDate',
          format: 'DDMMYY',
        },
        quantity: 'entries[].groundQuantity',
      },
      { quantityPath: 'entries[].groundQuantity', unit: 'kg' },
    ),
  ],
  'PPM-010': [
    generatedRule(
      'sugarCode',
      'Sugar Code',
      'entries[].sugarCode',
      '{{delivery}}{{supplier}}-{{production}}-{{quantity}}',
      {
        delivery: { path: 'entries[].deliveryDate', format: 'DDMMYY' },
        supplier: { path: 'entries[].supplierSurname', format: 'INITIAL' },
        production: {
          source: 'RECORD',
          path: 'productionDate',
          format: 'DDMMYY',
        },
        quantity: 'entries[].quantity',
      },
      { quantityPath: 'entries[].quantity', unit: 'kg' },
    ),
  ],
  'PPM-011': [
    generatedRule(
      'meringueCode',
      'Meringue Code',
      'meringueEntries[].meringueCode',
      '{{production}}-{{quantity}}-{{mixing}}',
      {
        production: {
          source: 'RECORD',
          path: 'productionDate',
          format: 'DDMMYY',
        },
        quantity: 'meringueEntries[].weight',
        mixing: 'meringueEntries[].mixingNumber',
      },
      { quantityPath: 'meringueEntries[].weight', unit: 'kg' },
    ),
    generatedRule(
      'mixingCode',
      'Batch Code / Mixing Code',
      'mixtureEntries[].mixingCode',
      '{{production}}-{{quantity}}-{{batch}}',
      {
        production: {
          source: 'RECORD',
          path: 'productionDate',
          format: 'DDMMYY',
        },
        quantity: 'mixtureEntries[].totalActualMixture',
        batch: 'mixtureEntries[].batchNumber',
      },
      { quantityPath: 'mixtureEntries[].totalActualMixture', unit: 'kg' },
    ),
  ],
  'PPM-012': [
    generatedRule(
      'formingSessionReference',
      'Operational Forming Session Reference',
      'entries[].formingSessionReference',
      '{{record}}:{{group}}',
      {
        record: { source: 'RECORD', path: 'id' },
        group: 'entries[].groupNumber',
      },
      { outputType: 'INTERNAL_OPERATIONAL_REFERENCE' },
    ),
  ],
  'PPM-014': [
    generatedRule(
      'bakedCode',
      'Baked Code',
      'entries[].bakedCode',
      '{{mixing}}-{{receiver}}-{{quantity}}-{{batch}}',
      {
        mixing: 'entries[].mixingCode',
        receiver: { path: 'entries[].receiverInitials', format: 'UPPERCASE' },
        quantity: 'entries[].quantity',
        batch: 'entries[].batchNumber',
      },
      { quantityPath: 'entries[].quantity', unit: 'kg' },
    ),
  ],
  'PPM-015': [
    generatedRule(
      'consumeBeforeCode',
      'Consume Before Code',
      'entries[].consumeBeforeCode',
      '{{expiry}}B{{batch}}',
      {
        expiry: {
          path: 'entries[].productionDate',
          format: 'DDMMMYY',
          dateOffsetMonths: 6,
        },
        batch: 'entries[].batchNumber',
      },
    ),
  ],
  'PPM-016': [
    generatedRule(
      'consumeBeforeCode',
      'Consume Before Code',
      'entries[].consumeBeforeCode',
      '{{expiry}}B{{batch}}',
      {
        expiry: {
          path: 'entries[].productionDate',
          format: 'DDMMMYY',
          dateOffsetMonths: 6,
        },
        batch: 'entries[].batchNumber',
      },
    ),
  ],
  'PPM-019': [
    generatedRule(
      'vanillaCode',
      'Vanilla Code',
      'entries[].vanillaCode',
      '{{product}}-{{quantity}}-{{expiry}}',
      {
        product: { path: 'entries[].productCode', format: 'UPPERCASE' },
        quantity: 'entries[].quantity',
        expiry: { path: 'entries[].expiryDate', format: 'DDMMYY' },
      },
      { quantityPath: 'entries[].quantity', unit: 'kg' },
    ),
  ],
  'PPM-020': [
    generatedRule(
      'frozenEggyolkCode',
      'Consume Before Code',
      'entries[].frozenEggyolkCode',
      '{{production}}{{batch}}',
      {
        production: {
          source: 'RECORD',
          path: 'productionDate',
          format: 'DDMMYY',
        },
        batch: 'entries[].batchNumber',
      },
      { quantityPath: 'entries[].eggyolkQuantity', unit: 'kg' },
    ),
  ],
  'PPM-021': [
    generatedRule(
      'rawReceivingReference',
      'Internal Receiving Entry Reference',
      'entries[].rawReceivingReference',
      '{{record}}:{{sack}}',
      {
        record: { source: 'RECORD', path: 'id' },
        sack: 'entries[].sackNumber',
      },
      {
        outputType: 'INTERNAL_SOURCE_ENTRY_REFERENCE',
        quantityPath: 'entries[].actualWeight',
        unit: 'kg',
      },
    ),
  ],
  'PPM-022': [
    generatedRule(
      'oilCode',
      'Oil Code',
      'entries[].oilCode',
      '{{arrival}}-{{quantity}}-{{expiry}}-{{container}}',
      {
        arrival: { path: 'entries[].arrivalDate', format: 'DDMMYY' },
        quantity: 'entries[].quantity',
        expiry: { path: 'entries[].expiryDate', format: 'DDMMYY' },
        container: 'entries[].containerNumber',
      },
      { quantityPath: 'entries[].quantity', unit: 'kg' },
    ),
  ],
  'PPM-026': [
    generatedRule(
      'sugarReceivingCode',
      'Internal Sugar Receiving Entry Reference',
      'entries[].sugarReceivingCode',
      '{{record}}:{{sack}}',
      {
        record: { source: 'RECORD', path: 'id' },
        sack: 'entries[].sackNumber',
      },
      {
        outputType: 'INTERNAL_SOURCE_ENTRY_REFERENCE',
        quantityPath: 'entries[].actualWeight',
        unit: 'kg',
      },
    ),
  ],
};

export function dailyPpmControlledForms(forms) {
  return forms.map((form) => {
    const spec = specs[form.ppmCode];
    const source = formSources[form.ppmCode];
    if (!spec)
      throw new Error(
        `Missing controlled daily definition for ${form.ppmCode}.`,
      );
    if (!source)
      throw new Error(
        `Missing controlled source register for ${form.ppmCode}.`,
      );
    const [sourceFileName, documentRevision, effectiveFrom, sourceFileHash] =
      source;
    return {
      ppmCode: form.ppmCode,
      versionNo: 3,
      versionLabel: `REV8.4_COMPLETE_TRACE_FORM_REV_${documentRevision}`,
      sourceFileName,
      sourceFileHash,
      effectiveFrom,
      documentRevision,
      definition: definition(form.ppmCode, form.title, spec),
      rules: ['PPM-005', 'PPM-006'].includes(form.ppmCode)
        ? []
        : (generatedRules[form.ppmCode] ??
          spec.outputs.map((outputKey) => ({
            outputKey,
            outputLabel:
              spec.entries?.find((field) => field.key === outputKey)?.label ??
              outputKey,
            sourceType: 'MANUAL_EXTERNAL',
            requiresUniqueBusinessCode: false,
            configurationJson: {
              outputPath: `entries[].${outputKey}`,
              outputType: 'CARRIED_OR_EXTERNAL_CODE',
            },
          }))),
    };
  });
}

export const dailyTraceConnections = [
  [
    'PPM-021',
    'rawReceivingReference',
    'PPM-004',
    'entries[].rawReceivingReference',
  ],
  ['PPM-004', 'sortingCode', 'PPM-007', 'entries[].sortingCode'],
  ['PPM-007', 'finalRoastingCode', 'PPM-008', 'entries[].finalRoastingCode'],
  ['PPM-008', 'grindingCode', 'PPM-009', 'entries[].grindingCode'],
  ['PPM-009', 'grindingCode', 'PPM-011', 'groundPeanutLots[].groundPeanutCode'],
  ['PPM-001', 'eggwhiteProductionCode', 'PPM-002', 'entries[].pailCode'],
  ['PPM-001', 'pitcherProductionCode', 'PPM-002', 'entries[].pitcherCode'],
  ['PPM-001', 'eggyolkProductionCode', 'PPM-003', 'entries[].eggyolkCode'],
  [
    'PPM-001',
    'eggwhiteProductionCode',
    'PPM-011',
    'meringueEntries[].eggwhiteCode',
  ],
  [
    'PPM-001',
    'pitcherProductionCode',
    'PPM-011',
    'meringueEntries[].eggwhiteCode',
  ],
  ['PPM-002', 'pailCode', 'PPM-011', 'meringueEntries[].eggwhiteCode'],
  ['PPM-002', 'pitcherCode', 'PPM-011', 'meringueEntries[].eggwhiteCode'],
  ['PPM-026', 'sugarReceivingCode', 'PPM-010', 'entries[].sugarReceivingCode'],
  ['PPM-010', 'sugarCode', 'PPM-011', 'meringueEntries[].sugarCode'],
  ['PPM-019', 'vanillaCode', 'PPM-011', 'meringueEntries[].vanillaCode'],
  ['PPM-003', 'eggyolkCode', 'PPM-020', 'entries[].eggyolkCode'],
  ['PPM-010', 'sugarCode', 'PPM-020', 'entries[].sugarCode'],
  ['PPM-011', 'meringueCode', 'PPM-011', 'mixtureEntries[].meringueCode'],
  ['PPM-011', 'mixingCode', 'PPM-012', 'entries[].mixingCode'],
  ['PPM-011', 'mixingCode', 'PPM-013', 'entries[].mixingCode'],
  ['PPM-011', 'mixingCode', 'PPM-014', 'entries[].mixingCode'],
  ['PPM-014', 'bakedCode', 'PPM-015', 'entries[].bakedCode'],
  ['PPM-014', 'bakedCode', 'PPM-016', 'entries[].bakedCode'],
  ['PPM-014', 'bakedCode', 'PPM-024', 'entries[].bakedCode'],
  ['PPM-024', 'rollCode', 'PPM-015', 'entries[].printedFoilRollCode'],
  ['PPM-024', 'rollCode', 'PPM-016', 'entries[].plainFoilRollCode'],
  ['PPM-015', 'consumeBeforeCode', 'PPM-017', 'entries[].consumeBeforeCode'],
  ['PPM-016', 'consumeBeforeCode', 'PPM-017', 'entries[].consumeBeforeCode'],
  ['PPM-017', 'consumeBeforeCode', 'PPM-018', 'entries[].consumeBeforeCode'],
  ['PPM-022', 'oilCode', 'PPM-022', 'entries[].usageOilCode'],
  [
    'PPM-012',
    'formingSessionReference',
    'PPM-023',
    'entries[].formingSessionReference',
  ],
].map(([sourcePpm, sourceOutputKey, targetPpm, targetInputKey], index) => ({
  sourcePpm,
  sourceOutputKey,
  targetPpm,
  targetInputKey,
  connectionName: `REV84-FORM-${String(index + 1).padStart(3, '0')}`,
  notes:
    'Activated from the supplied PPM form workflow and Revision 8.4 implementation request.',
}));
