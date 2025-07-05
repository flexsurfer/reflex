export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: ["/node_modules/", "/implementations/"],
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