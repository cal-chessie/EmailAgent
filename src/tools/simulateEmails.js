/**
 * Test email simulator — injects fake inbound emails for testing
 * Run with: node src/tools/simulateEmails.js
 */

const TEST_EMAILS = [
  {
    id: 'test-001',
    from: 'jane.smith@example.com',
    subject: 'Solar panel installation for my home',
    body: `Hi, I'm interested in getting solar panels installed on my house. 
We have a south-facing roof and pay around €180/month on electricity. 
Would like to install within the next 3 months if possible. 
Can you give me a quote?`,
    threadId: 'thread-001',
  },
  {
    id: 'test-002',
    from: 'warehouse-ops@bigretail.co.uk',
    subject: 'Commercial solar survey enquiry',
    body: `We run a 50,000 sq ft warehouse and want to go solar. 
Current electricity bill is €4,200/month. 
Looking to install by Q4. 
What's involved and can you send someone to survey?`,
    threadId: 'thread-002',
  },
  {
    id: 'test-003',
    from: 'dave.bloggs@outlook.co.uk',
    subject: 'Solar?',
    body: `Hi, heard solar could save us money. We have a 3-bed semi. 
Our bill is about €110 a month. Not sure if we can afford it yet. 
Maybe next year?`,
    threadId: 'thread-003',
  },
  {
    id: 'test-004',
    from: 'bad-email', // test sanitization
    subject: '<b>Solar</b> enquiry',
    body: `Hello solar!`,
    threadId: 'thread-004',
  },
];

export { TEST_EMAILS };