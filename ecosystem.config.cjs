module.exports = {
  apps: [
    {
      name: 'cms-vicastcam-com',
      cwd: __dirname,
      script: 'npm',
      args: 'run start',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 1337,
      },
    },
  ],
};
