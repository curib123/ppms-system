import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient, UserRole } from '@prisma/client';
import {
  warehouseConnections,
  warehouseControlledForms,
} from './warehouse-baseline.mjs';
import {
  dailyPpmControlledForms,
  dailyTraceConnections,
} from './daily-ppm-baseline.mjs';

const EXPECTED_SEED_HASH =
  '4b5372e0f1e2a72628e0f87fece0629c792ae08131cf51855ea1412db30c6f0b';
const OBSOLETE_WAREHOUSE_TRANSFER_CODES = [
  'WH-STM-20G',
  'WH-STM-100G',
  'WH-STM-200G',
  'WH-STM-SPECIAL',
];
const seedUrl = new URL('./seed-baseline.json', import.meta.url);
const seedBytes = await readFile(seedUrl);
const seedHash = createHash('sha256').update(seedBytes).digest('hex');
if (seedHash !== EXPECTED_SEED_HASH) {
  throw new Error('Canonical seed hash mismatch. Refusing database writes.');
}
const seed = JSON.parse(seedBytes.toString('utf8'));
const prisma = new PrismaClient();

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

try {
  const expectedRoles = [...seed.roles].sort();
  const schemaRoles = Object.values(UserRole).sort();
  if (!same(expectedRoles, schemaRoles)) {
    throw new Error('Canonical roles do not match the Prisma UserRole enum.');
  }

  const result = await prisma.$transaction(async (database) => {
    for (const area of seed.areas) {
      const current = await database.productionArea.findUnique({
        where: { code: area.code },
      });
      const desired = { name: area.name, status: 'ACTIVE' };
      if (!current) {
        await database.productionArea.create({
          data: { code: area.code, ...desired },
        });
      } else if (
        current.name !== desired.name ||
        current.status !== desired.status
      ) {
        await database.productionArea.update({
          where: { code: area.code },
          data: desired,
        });
      }
    }

    for (const [index, form] of seed.forms.entries()) {
      const current = await database.ppmForm.findUnique({
        where: { ppmCode: form.ppmCode },
      });
      const desired = {
        title: form.title,
        status: form.status,
        sortOrder: index + 1,
      };
      if (!current) {
        await database.ppmForm.create({
          data: { ppmCode: form.ppmCode, ...desired },
        });
      } else if (
        current.title !== desired.title ||
        current.status !== desired.status ||
        current.sortOrder !== desired.sortOrder
      ) {
        await database.ppmForm.update({
          where: { ppmCode: form.ppmCode },
          data: desired,
        });
      }
    }

    const forms = await database.ppmForm.findMany({
      select: { id: true, ppmCode: true },
    });
    const formIds = new Map(forms.map((form) => [form.ppmCode, form.id]));

    const obsoleteWarehouseFormIds = OBSOLETE_WAREHOUSE_TRANSFER_CODES.map(
      (ppmCode) => formIds.get(ppmCode),
    ).filter(Boolean);
    if (obsoleteWarehouseFormIds.length) {
      const obsoleteRecordCount = await database.ppmRecord.count({
        where: {
          areaPpmAssignment: {
            ppmFormId: { in: obsoleteWarehouseFormIds },
          },
        },
      });
      if (obsoleteRecordCount === 0) {
        const obsoleteConnectionWhere = {
          OR: [
            { sourcePpmFormId: { in: obsoleteWarehouseFormIds } },
            { targetPpmFormId: { in: obsoleteWarehouseFormIds } },
          ],
        };
        await database.ppmTraceConnection.deleteMany({
          where: obsoleteConnectionWhere,
        });
        await database.codeSequence.deleteMany({
          where: {
            codeRule: {
              templateVersion: {
                ppmFormId: { in: obsoleteWarehouseFormIds },
              },
            },
          },
        });
        await database.traceCodeRule.deleteMany({
          where: {
            templateVersion: {
              ppmFormId: { in: obsoleteWarehouseFormIds },
            },
          },
        });
        await database.ppmTemplateVersion.deleteMany({
          where: { ppmFormId: { in: obsoleteWarehouseFormIds } },
        });
        await database.personnelPpmAssignment.deleteMany({
          where: { ppmFormId: { in: obsoleteWarehouseFormIds } },
        });
        await database.areaPpmAssignment.deleteMany({
          where: { ppmFormId: { in: obsoleteWarehouseFormIds } },
        });
        await database.ppmForm.deleteMany({
          where: { id: { in: obsoleteWarehouseFormIds } },
        });
        for (const ppmCode of OBSOLETE_WAREHOUSE_TRANSFER_CODES)
          formIds.delete(ppmCode);
      } else {
        const retiredAt = new Date();
        await database.ppmTraceConnection.updateMany({
          where: {
            OR: [
              { sourcePpmFormId: { in: obsoleteWarehouseFormIds } },
              { targetPpmFormId: { in: obsoleteWarehouseFormIds } },
            ],
          },
          data: { status: 'DISABLED' },
        });
        await database.traceCodeRule.updateMany({
          where: {
            templateVersion: {
              ppmFormId: { in: obsoleteWarehouseFormIds },
            },
          },
          data: { status: 'DISABLED' },
        });
        await database.ppmTemplateVersion.updateMany({
          where: { ppmFormId: { in: obsoleteWarehouseFormIds } },
          data: { isActive: false, effectiveTo: retiredAt },
        });
        await database.areaPpmAssignment.updateMany({
          where: { ppmFormId: { in: obsoleteWarehouseFormIds } },
          data: { isActive: false, effectiveTo: retiredAt },
        });
        await database.ppmForm.updateMany({
          where: { id: { in: obsoleteWarehouseFormIds } },
          data: { status: 'INACTIVE' },
        });
      }
    }

    const areas = await database.productionArea.findMany({
      select: { id: true, code: true, name: true },
    });
    const areaIds = new Map(areas.map((area) => [area.code, area.id]));
    const areaIdsByName = new Map(areas.map((area) => [area.name, area.id]));

    // Every canonical PPM belongs to exactly one operational area. Earlier
    // seeds only created assignments for forms that had a controlled template,
    // which left most of the PPM register unusable in Records and Personnel
    // assignment screens. Keep this mapping driven by the canonical register
    // so adding a template is never a prerequisite for area visibility.
    for (const form of seed.forms) {
      const ppmFormId = formIds.get(form.ppmCode);
      const areaId = areaIdsByName.get(form.area);
      if (!ppmFormId || !areaId) {
        throw new Error(
          `Canonical form ${form.ppmCode} references unknown area ${form.area}.`,
        );
      }
      const assignments = await database.areaPpmAssignment.findMany({
        where: { areaId, ppmFormId },
        orderBy: { createdAt: 'asc' },
        include: { _count: { select: { records: true } } },
      });
      const assignment =
        assignments.find((item) => item._count.records > 0) ?? assignments[0];
      if (!assignment) {
        await database.areaPpmAssignment.create({
          data: { areaId, ppmFormId, isActive: form.status === 'ACTIVE' },
        });
      } else if (
        assignment.isActive !== (form.status === 'ACTIVE') ||
        (form.status === 'ACTIVE' && assignment.effectiveTo)
      ) {
        await database.areaPpmAssignment.update({
          where: { id: assignment.id },
          data: {
            isActive: form.status === 'ACTIVE',
            effectiveTo: form.status === 'ACTIVE' ? null : new Date(),
          },
        });
      }

      const redundantCanonicalAssignments = assignments.filter(
        (item) => item.id !== assignment.id && item._count.records === 0,
      );
      if (redundantCanonicalAssignments.length) {
        await database.areaPpmAssignment.updateMany({
          where: {
            id: { in: redundantCanonicalAssignments.map(({ id }) => id) },
          },
          data: { isActive: false, effectiveTo: new Date() },
        });
      }

      const conflictingAssignments = await database.areaPpmAssignment.findMany({
        where: {
          ppmFormId,
          areaId: { not: areaId },
          isActive: true,
          records: { none: {} },
        },
        select: { id: true },
      });
      if (conflictingAssignments.length) {
        await database.areaPpmAssignment.updateMany({
          where: { id: { in: conflictingAssignments.map(({ id }) => id) } },
          data: { isActive: false, effectiveTo: new Date() },
        });
      }
    }

    for (const controlled of warehouseControlledForms) {
      const ppmFormId = formIds.get(controlled.ppmCode);
      const areaId = areaIds.get(controlled.areaCode);
      if (!ppmFormId || !areaId)
        throw new Error(
          `Controlled Warehouse form ${controlled.ppmCode} references unknown master data.`,
        );
      const assignment = await database.areaPpmAssignment.findFirst({
        where: { areaId, ppmFormId },
        orderBy: { createdAt: 'asc' },
      });
      if (!assignment) {
        await database.areaPpmAssignment.create({
          data: { areaId, ppmFormId, isActive: true },
        });
      } else if (!assignment.isActive || assignment.effectiveTo) {
        await database.areaPpmAssignment.update({
          where: { id: assignment.id },
          data: { isActive: true, effectiveTo: null },
        });
      }

      let template = await database.ppmTemplateVersion.findUnique({
        where: {
          ppmFormId_versionNo: {
            ppmFormId,
            versionNo: controlled.versionNo,
          },
        },
      });
      if (!template) {
        template = await database.ppmTemplateVersion.create({
          data: {
            ppmFormId,
            versionNo: controlled.versionNo,
            versionLabel: controlled.versionLabel,
            effectiveFrom: new Date(
              `${controlled.effectiveFrom}T00:00:00.000Z`,
            ),
            isActive: true,
            publishedAt: new Date('2026-08-28T00:00:00.000Z'),
            sourceFileName: controlled.sourceFileName,
            documentNumber: controlled.documentNumber,
            revisionNumber: controlled.revisionNumber,
            definitionJson: controlled.definition,
          },
        });
      } else {
        template = await database.ppmTemplateVersion.update({
          where: { id: template.id },
          data: {
            versionLabel: controlled.versionLabel,
            effectiveFrom: new Date(
              `${controlled.effectiveFrom}T00:00:00.000Z`,
            ),
            isActive: true,
            publishedAt:
              template.publishedAt ?? new Date('2026-08-28T00:00:00.000Z'),
            sourceFileName: controlled.sourceFileName,
            documentNumber: controlled.documentNumber,
            revisionNumber: controlled.revisionNumber,
            definitionJson: controlled.definition,
          },
        });
      }
      await database.ppmTemplateVersion.updateMany({
        where: { ppmFormId, id: { not: template.id }, isActive: true },
        data: { isActive: false },
      });
      for (const rule of controlled.rules) {
        const desiredRule = {
          outputLabel: rule.outputLabel,
          status: 'ACTIVE',
          sourceType: rule.sourceType,
          formulaTemplate: rule.formulaTemplate ?? null,
          resetPeriod: 'NONE',
          requiresUniqueBusinessCode: false,
          configurationJson: rule.configurationJson,
        };
        const existingRule = await database.traceCodeRule.findUnique({
          where: {
            templateVersionId_outputKey: {
              templateVersionId: template.id,
              outputKey: rule.outputKey,
            },
          },
        });
        if (!existingRule) {
          await database.traceCodeRule.create({
            data: {
              templateVersionId: template.id,
              outputKey: rule.outputKey,
              ...desiredRule,
            },
          });
        } else if (
          existingRule.outputLabel !== desiredRule.outputLabel ||
          existingRule.status !== desiredRule.status ||
          existingRule.sourceType !== desiredRule.sourceType ||
          existingRule.formulaTemplate !== desiredRule.formulaTemplate ||
          existingRule.resetPeriod !== desiredRule.resetPeriod ||
          existingRule.requiresUniqueBusinessCode !==
            desiredRule.requiresUniqueBusinessCode ||
          JSON.stringify(existingRule.configurationJson) !==
            JSON.stringify(desiredRule.configurationJson)
        ) {
          await database.traceCodeRule.update({
            where: { id: existingRule.id },
            data: desiredRule,
          });
        }
      }
    }

    for (const connection of seed.connections) {
      const sourcePpmFormId = formIds.get(connection.sourcePpm);
      const targetPpmFormId = formIds.get(connection.targetPpm);
      if (!sourcePpmFormId || !targetPpmFormId) {
        throw new Error(
          `Canonical real-form connection ${connection.connectionId} references an unknown form.`,
        );
      }
      const identity = {
        sourcePpmFormId,
        sourceOutputKey: connection.sourceOutputKey,
        targetPpmFormId,
        targetInputKey: connection.targetInputKey,
      };
      const current = await database.ppmTraceConnection.findUnique({
        where: {
          sourcePpmFormId_sourceOutputKey_targetPpmFormId_targetInputKey:
            identity,
        },
      });
      const desired = {
        connectionName: connection.connectionId,
        status: connection.status,
        requiresApprovalBeforeUse: connection.requiresApprovalBeforeUse,
        notes: connection.notes ?? null,
      };
      if (!current) {
        await database.ppmTraceConnection.create({
          data: { ...identity, ...desired },
        });
      } else if (
        current.connectionName !== desired.connectionName ||
        current.status !== desired.status ||
        current.requiresApprovalBeforeUse !==
          desired.requiresApprovalBeforeUse ||
        current.notes !== desired.notes
      ) {
        await database.ppmTraceConnection.update({
          where: { id: current.id },
          data: desired,
        });
      }
    }

    await database.ppmTraceConnection.updateMany({
      where: {
        sourcePpmFormId: formIds.get('PPM-004'),
        targetPpmFormId: formIds.get('PPM-007'),
        targetInputKey: 'finalSortingCode',
        status: 'ACTIVE',
      },
      data: { status: 'DISABLED' },
    });

    const activeWarehouseConnectionIds = [];
    for (const connection of warehouseConnections) {
      const sourcePpmFormId = formIds.get(connection.sourcePpm);
      const targetPpmFormId = formIds.get(connection.targetPpm);
      if (!sourcePpmFormId || !targetPpmFormId)
        throw new Error(
          `Warehouse connection ${connection.connectionName} references an unknown form.`,
        );
      const identity = {
        sourcePpmFormId,
        sourceOutputKey: connection.sourceOutputKey,
        targetPpmFormId,
        targetInputKey: connection.targetInputKey,
      };
      const current = await database.ppmTraceConnection.findUnique({
        where: {
          sourcePpmFormId_sourceOutputKey_targetPpmFormId_targetInputKey:
            identity,
        },
      });
      const desired = {
        connectionName: connection.connectionName,
        status: 'ACTIVE',
        requiresApprovalBeforeUse: false,
        notes: connection.notes,
      };
      if (!current) {
        const created = await database.ppmTraceConnection.create({
          data: { ...identity, ...desired },
          select: { id: true },
        });
        activeWarehouseConnectionIds.push(created.id);
      } else if (
        current.connectionName !== desired.connectionName ||
        current.status !== desired.status ||
        current.requiresApprovalBeforeUse ||
        current.notes !== desired.notes
      ) {
        const updated = await database.ppmTraceConnection.update({
          where: { id: current.id },
          data: desired,
          select: { id: true },
        });
        activeWarehouseConnectionIds.push(updated.id);
      } else activeWarehouseConnectionIds.push(current.id);
    }
    await database.ppmTraceConnection.updateMany({
      where: {
        connectionName: { startsWith: 'WAREHOUSE-' },
        id: { notIn: activeWarehouseConnectionIds },
        status: 'ACTIVE',
      },
      data: { status: 'DISABLED' },
    });

    for (const controlled of dailyPpmControlledForms(
      seed.forms.filter((form) => /^PPM-\d+$/u.test(form.ppmCode)),
    )) {
      const ppmFormId = formIds.get(controlled.ppmCode);
      if (!ppmFormId)
        throw new Error(`Daily form ${controlled.ppmCode} is not registered.`);
      const isReserved = ['PPM-005', 'PPM-006'].includes(controlled.ppmCode);
      await database.ppmForm.update({
        where: { id: ppmFormId },
        data: { status: isReserved ? 'RESERVED' : 'ACTIVE' },
      });
      const identity = {
        ppmFormId_versionNo: {
          ppmFormId,
          versionNo: controlled.versionNo,
        },
      };
      let template = await database.ppmTemplateVersion.findUnique({
        where: identity,
      });
      if (!template) {
        template = await database.ppmTemplateVersion.create({
          data: {
            ppmFormId,
            versionNo: controlled.versionNo,
            versionLabel: controlled.versionLabel,
            effectiveFrom: new Date(
              `${controlled.effectiveFrom}T00:00:00.000Z`,
            ),
            isActive: !isReserved,
            publishedAt: new Date('2026-08-25T00:00:00.000Z'),
            sourceFileName: controlled.sourceFileName,
            sourceFileHash: controlled.sourceFileHash,
            documentNumber: controlled.ppmCode,
            revisionNumber: controlled.documentRevision,
            definitionJson: controlled.definition,
          },
        });
      } else {
        template = await database.ppmTemplateVersion.update({
          where: { id: template.id },
          data: {
            versionLabel: controlled.versionLabel,
            effectiveFrom: new Date(
              `${controlled.effectiveFrom}T00:00:00.000Z`,
            ),
            isActive: !isReserved,
            publishedAt:
              template.publishedAt ?? new Date('2026-08-25T00:00:00.000Z'),
            sourceFileName: controlled.sourceFileName,
            sourceFileHash: controlled.sourceFileHash,
            documentNumber: controlled.ppmCode,
            revisionNumber: controlled.documentRevision,
            definitionJson: controlled.definition,
          },
        });
      }
      await database.ppmTemplateVersion.updateMany({
        where: { ppmFormId, id: { not: template.id }, isActive: true },
        data: { isActive: false },
      });
      for (const rule of controlled.rules) {
        await database.traceCodeRule.upsert({
          where: {
            templateVersionId_outputKey: {
              templateVersionId: template.id,
              outputKey: rule.outputKey,
            },
          },
          create: {
            templateVersionId: template.id,
            outputKey: rule.outputKey,
            outputLabel: rule.outputLabel,
            status: 'ACTIVE',
            sourceType: rule.sourceType,
            formulaTemplate: rule.formulaTemplate ?? null,
            resetPeriod: 'NONE',
            requiresUniqueBusinessCode:
              rule.requiresUniqueBusinessCode ?? false,
            configurationJson: rule.configurationJson,
          },
          update: {
            outputLabel: rule.outputLabel,
            status: 'ACTIVE',
            sourceType: rule.sourceType,
            formulaTemplate: rule.formulaTemplate ?? null,
            resetPeriod: 'NONE',
            requiresUniqueBusinessCode:
              rule.requiresUniqueBusinessCode ?? false,
            configurationJson: rule.configurationJson,
          },
        });
      }
      await database.traceCodeRule.updateMany({
        where: {
          templateVersionId: template.id,
          outputKey: { notIn: controlled.rules.map((rule) => rule.outputKey) },
          status: 'ACTIVE',
        },
        data: { status: 'DISABLED' },
      });
    }

    const activeDailyConnectionIds = [];
    for (const connection of dailyTraceConnections) {
      const sourcePpmFormId = formIds.get(connection.sourcePpm);
      const targetPpmFormId = formIds.get(connection.targetPpm);
      if (!sourcePpmFormId || !targetPpmFormId)
        throw new Error(
          `Daily trace connection ${connection.connectionName} references an unknown form.`,
        );
      const identity = {
        sourcePpmFormId,
        sourceOutputKey: connection.sourceOutputKey,
        targetPpmFormId,
        targetInputKey: connection.targetInputKey,
      };
      const activeConnection = await database.ppmTraceConnection.upsert({
        where: {
          sourcePpmFormId_sourceOutputKey_targetPpmFormId_targetInputKey:
            identity,
        },
        create: {
          ...identity,
          connectionName: connection.connectionName,
          status: 'ACTIVE',
          requiresApprovalBeforeUse: false,
          notes: connection.notes,
        },
        update: {
          connectionName: connection.connectionName,
          status: 'ACTIVE',
          requiresApprovalBeforeUse: false,
          notes: connection.notes,
        },
        select: { id: true },
      });
      activeDailyConnectionIds.push(activeConnection.id);
    }
    await database.ppmTraceConnection.updateMany({
      where: {
        connectionName: { startsWith: 'REV84-FORM-' },
        id: { notIn: activeDailyConnectionIds },
        status: 'ACTIVE',
      },
      data: { status: 'DISABLED' },
    });

    for (const setting of seed.systemSettings) {
      const current = await database.systemSetting.findUnique({
        where: { key: setting.key },
      });
      const desired = {
        valueJson: setting.valueJson,
        valueType: setting.valueType,
        description: setting.description ?? null,
        isSensitive: false,
      };
      if (!current) {
        await database.systemSetting.create({
          data: { key: setting.key, ...desired },
        });
      } else if (
        !same(current.valueJson, desired.valueJson) ||
        current.valueType !== desired.valueType ||
        current.description !== desired.description ||
        current.isSensitive !== desired.isSensitive
      ) {
        await database.systemSetting.update({
          where: { key: setting.key },
          data: desired,
        });
      }
    }

    return {
      roles: schemaRoles.length,
      areas: await database.productionArea.count(),
      forms: await database.ppmForm.count(),
      connections: await database.ppmTraceConnection.count(),
      settings: await database.systemSetting.count(),
    };
  });

  console.log(JSON.stringify({ status: 'seeded', ...result }));
} finally {
  await prisma.$disconnect();
}
