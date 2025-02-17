module.exports = {
    testEnvironment: 'node',
    transform: {
        '^.+\\.jsx?$': 'babel-jest'
    },
    testMatch: ['**/testSuite/**/*.test.js'],
    setupFiles: ['./testSuite/setup.js']
}; 