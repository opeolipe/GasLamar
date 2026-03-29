/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './*.html',
    './js/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#1B4FE8',
        accent:  '#22C55E',
        warning: '#F59E0B',
        danger:  '#EF4444',
      },
      fontFamily: {
        heading: ['"Plus Jakarta Sans"', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
