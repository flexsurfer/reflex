export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js'],
  testPathIgnorePatterns: ["/node_modules/", "/implementations/", "/examples/"],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  testEnvironmentOptions: {
    customExportConditions: ['react-jsx'],
  },
  // Suppress expected console output during tests
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js']
};