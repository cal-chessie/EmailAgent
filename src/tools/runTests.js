/**
 * Test runner — runs all test emails and reports results
 * Run with: node src/tools/runTests.js
 */
import { TEST_EMAILS } from './simulateEmails.js';
import { qualifyLead } from '../agents/qualification.js';
import { sanitizeHtml, isValidEmail, validateQualification } from './sanitize.js';
import { normalizePhone } from './sanitize.js';
import { withRetry } from './retry.js';
import { isAlreadyProcessed, markProcessed, clearProcessed } from './idempotency.js';

// Simulated LLM responses for testing without OpenAI API key
const MOCK_LLM_RESPONSES = {
  'test-001': {
    name: 'Jane Smith',
    phone: '+447700900001',
    type: 'domestic',
    property: '3-bed semi, south-facing roof',
    bill: '€180/month',
    timeline: 'eager',
    notes: 'South-facing roof is ideal',
  },
  'test-002': {
    name: 'Warehouse Ops',
    phone: '+447700900002',
    type: 'commercial',
    property: '50,000 sq ft warehouse',
    bill: '€4,200/month',
    timeline: 'considering',
    notes: 'Q4 target, large installation',
  },
  'test-003': {
    name: 'Dave Bloggs',
    phone: null,
    type: 'domestic',
    property: '3-bed semi',
    bill: '€110/month',
    timeline: 'browsing',
    notes: 'Budget-sensitive, not urgent',
  },
  'test-004': null, // will cause validation failure
};

let passed = 0;
let failed = 0;

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  🧪 Solar Agent — Test Runner');
  console.log('═══════════════════════════════════════\n');

  for (const email of TEST_EMAILS) {
    // Clear idempotency for this test email
    clearProcessed(email.id);

    const testEmail = {
      ...email,
      subject: sanitizeHtml(email.subject),
      body: sanitizeHtml(email.body).slice(0, 5000),
    };

    console.log(`\n▶ Test: ${email.from} (${email.id})`);

    const expectReject = MOCK_LLM_RESPONSES[email.id] === null;
    try {
      // 1. Validate email input
      if (!isValidEmail(testEmail.from)) {
        if (expectReject) {
          console.log(`  ✅ PASSED (correctly rejected: ${testEmail.from})\n`);
          passed++;
          continue;
        }
        throw new Error(`Invalid email address: ${testEmail.from}`);
      }
      console.log(`  ✓ Input sanitization passed`);

      // 2. Idempotency
      if (isAlreadyProcessed(testEmail.id)) {
        throw new Error('Already processed (idempotency check)');
      }
      console.log(`  ✓ Idempotency check passed`);

      // 3. LLM qualification (mocked)
      const mockResponse = MOCK_LLM_RESPONSES[email.id];
      if (!mockResponse) {
        throw new Error('No mock response defined');
      }

      const qualification = mockResponse;
      console.log(`  ✓ Qualification: ${qualification.type} | ${qualification.bill} | ${qualification.timeline}`);

      // 4. Validate qualification output
      const { valid, errors } = validateQualification(qualification);
      if (!valid) {
        console.warn(`  ⚠ Validation warnings: ${errors.join(', ')}`);
      } else {
        console.log(`  ✓ Qualification validation passed`);
      }

      // 5. Normalize phone
      if (qualification.phone) {
        const norm = normalizePhone(qualification.phone);
        if (norm !== qualification.phone) {
          console.log(`  ✓ Phone normalized: ${qualification.phone} → ${norm}`);
        }
      }

      // 6. Mark as processed
      markProcessed(email.id, { status: 'test-success' });
      console.log(`  ✅ PASSED\n`);

    } catch (err) {
      console.error(`  ❌ FAILED: ${err.message}\n`);
      failed++;
      continue;
    }

    passed++;
  }

  // 7. Irish + UK phone normalisation table (IE-first localisation)
  console.log('\n▶ Phone normalisation (IE-first)');
  const PHONE_CASES = [
    ['087 123 4567',    '+353871234567'],  // IE mobile, spaced
    ['0871234567',      '+353871234567'],  // IE mobile, bare
    ['086-234-5678',    '+353862345678'],  // IE mobile, dashed
    ['083 852 1122',    '+353838521122'],  // IE mobile, newer prefix
    ['+353 87 123 4567','+353871234567'],  // already E.164, spaced
    ['00353871234567',  '+353871234567'],  // international 00 prefix
    ['01 234 5678',     '+35312345678'],   // Dublin landline (9 digits)
    ['021 4345678',     '+353214345678'],  // Cork landline (10 digits)
    ['07700 900123',    '+447700900123'],  // UK mobile (11 digits) still works
    ['+447700900123',   '+447700900123'],  // UK E.164 untouched
  ];
  for (const [input, expected] of PHONE_CASES) {
    const got = normalizePhone(input);
    if (got === expected) {
      console.log(`  ✓ ${input} → ${got}`);
      passed++;
    } else {
      console.error(`  ❌ ${input} → ${got} (expected ${expected})`);
      failed++;
    }
  }

  console.log('═══════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

run();