process.env.NODE_ENV = 'test';
process.env.TEST_MODE = 'true';
process.env.DATABASE_URL = 'file:./tests/cloud-test.db';
process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests-only';
process.env.AUTH_BYPASS = 'false';
process.env.ENABLE_REQUEST_LOGGING = 'false';

jest.setTimeout(60000);

afterAll(async () => {});
