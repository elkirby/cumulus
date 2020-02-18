'use strict';

const test = require('ava');
const rewire = require('rewire');

const awsServices = require('@cumulus/aws-client/services');
const { noop } = require('@cumulus/common/util');
const { randomString } = require('@cumulus/common/test-utils');

const publishReports = rewire('../../../lambdas/publish-reports');

const testMessagesReceived = async (t, QueueUrl, pdrName) => {
  const { Messages } = await awsServices.sqs().receiveMessage({
    QueueUrl,
    WaitTimeSeconds: 3,
    MaxNumberOfMessages: 2
  }).promise();

  if (pdrName) t.is(Messages.length, 1);
  else t.is(Messages, undefined);

  if (pdrName) {
    const snsMessages = Messages.map((message) => JSON.parse(message.Body));
    const dbRecords = snsMessages.map((message) => JSON.parse(message.Message));

    const pdrRecord = dbRecords.find((r) => r.pdrName);
    t.is(pdrRecord.pdrName, pdrName);
  }
};

test.beforeEach(async (t) => {
  // Configure the SNS topics and SQS subscriptions
  t.context.pdrSnsTopicArnEnvVarBefore = process.env.pdr_sns_topic_arn;

  const topicName = randomString();
  const { TopicArn } = await awsServices.sns().createTopic({
    Name: topicName
  }).promise();
  t.context.TopicArn = TopicArn;
  process.env.pdr_sns_topic_arn = TopicArn;

  const QueueName = randomString();
  const { QueueUrl } = await awsServices.sqs().createQueue({ QueueName }).promise();
  t.context.QueueUrl = QueueUrl;

  const getQueueAttributesResponse = await awsServices.sqs().getQueueAttributes({
    QueueUrl: QueueUrl,
    AttributeNames: ['QueueArn']
  }).promise();
  const queueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await awsServices.sns().subscribe({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: queueArn
  }).promise();

  await awsServices.sns().confirmSubscription({
    TopicArn: TopicArn,
    Token: SubscriptionArn
  }).promise();

  // Configure the test data

  t.context.pdrName = randomString();

  t.context.cumulusMessage = {
    meta: {
      provider: {
        protocol: 'https',
        host: 'example.com',
        port: 80
      }
    },
    cumulus_meta: {
      execution_name: randomString(),
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine'
    },
    payload: {
      pdr: {
        name: t.context.pdrName
      }
    }
  };

  t.context.executionEvent = {
    detail: {
      status: 'RUNNING',
      input: JSON.stringify(t.context.cumulusMessage)
    }
  };
});

test.afterEach.always(async (t) => {
  const {
    pdrSnsTopicArnEnvVarBefore,
    QueueUrl,
    TopicArn
  } = t.context;

  process.env.pdr_sns_topic_arn = pdrSnsTopicArnEnvVarBefore;

  await awsServices.sqs().deleteQueue({ QueueUrl }).promise()
    .catch(noop);
  await awsServices.sns().deleteTopic({ TopicArn }).promise()
    .catch(noop);
});

test.serial('handler() publishes a PDR  to SNS', async (t) => {
  const {
    pdrName, QueueUrl, executionEvent
  } = t.context;

  await publishReports.handler(executionEvent);

  await testMessagesReceived(t, QueueUrl, pdrName);
});

test.serial('publishReportSnsMessages() publishes a PDR to SNS', async (t) => {
  const {
    pdrName, QueueUrl, cumulusMessage
  } = t.context;

  await publishReports.publishReportSnsMessages(cumulusMessage);

  await testMessagesReceived(t, QueueUrl, pdrName);
});

test.serial('handlePdrMessage() publishes a PDR record to SNS', async (t) => {
  const { cumulusMessage, pdrName, QueueUrl } = t.context;

  delete cumulusMessage.payload.granules;

  await publishReports.handlePdrMessage(cumulusMessage);

  await testMessagesReceived(t, QueueUrl, pdrName);
});

test.serial('handlePdrMessage() does not publish a PDR record to SNS if the Cumulus message does not contain a PDR', async (t) => {
  const { cumulusMessage, QueueUrl } = t.context;

  delete cumulusMessage.payload.pdr;

  await publishReports.handlePdrMessage(cumulusMessage);

  await testMessagesReceived(t, QueueUrl, null);
});

test.serial('handlePdrMessage() does not throw an exception if generating the PDR record fails', async (t) => {
  const { cumulusMessage } = t.context;

  delete cumulusMessage.payload.pdr.name;

  await t.notThrowsAsync(
    () => publishReports.__with__({
      publishSnsMessage: () => Promise.reject(new Error('nope'))
    })(() => publishReports.handlePdrMessage(cumulusMessage))
  );
});

test.serial('handlePdrMessage() does not throw an exception if publishing the PDR record to SNS fails', async (t) => {
  const { cumulusMessage } = t.context;

  await t.notThrowsAsync(
    () => publishReports.__with__({
      publishSnsMessage: () => Promise.reject(new Error('nope'))
    })(() => publishReports.handlePdrMessage(cumulusMessage))
  );
});
