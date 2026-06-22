/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow large image uploads
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

module.exports = nextConfig;
