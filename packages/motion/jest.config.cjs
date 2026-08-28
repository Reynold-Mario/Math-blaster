/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  // `node`, not `jsdom`: the whole reason `MotionEnvironment` is a port is that
  // the interesting half of this module runs without a browser.
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
};
