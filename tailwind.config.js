/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./public/**/*.{html,js}"],
  theme: {
    extend: {
      colors: {
        red: {
          500: '#f51324',
          600: '#d81020', // slightly darker for hover states
        }
      }
    }
  },
  plugins: [],
} 