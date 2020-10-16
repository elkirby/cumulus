import * as Knex from 'knex';

export const up = async (knex: Knex): Promise<void> =>
  knex.schema.createTable('executions', (table) => {
    table
      .increments('cumulusId')
      .primary();
    table
      .text('arn')
      .comment('Execution ARN')
      .notNullable();
    table
      .integer('asyncOperationsCumulusId')
      .references('cumulusId')
      .inTable('asyncOperations');
    table
      .integer('collectionCumulusId')
      .references('cumulusId')
      .inTable('collections');
    table
      .integer('parentCumulusId')
      .references('cumulusId')
      .inTable('executions');
    table
      .timestamps(false, true);
    table.unique(['arn']);
  });

export const down = async (knex: Knex): Promise<void> => knex.schema
  .dropTableIfExists('executions');
