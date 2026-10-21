// Runs before each test file's imports resolve env.ts.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://anvaya:anvaya_dev_password@localhost:5433/anvaya_test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.ML_SERVICE_URL = 'http://127.0.0.1:59999';
process.env.ML_SERVICE_TOKEN = 'test-token';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_test';
