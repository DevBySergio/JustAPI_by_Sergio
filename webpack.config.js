//@ts-check

'use strict';

const path = require('path');
const webpack = require('webpack');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @returns {WebpackConfig[]} */
module.exports = (_env, argv) => {
  const mode = argv.mode || 'none';

  /** @type WebpackConfig */
  const extensionConfig = {
    target: 'node',
    mode,
    entry: './src/extension.ts',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'extension.js',
      libraryTarget: 'commonjs2',
    },
    externals: {
      vscode: 'commonjs vscode',
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: [{ loader: 'ts-loader' }],
        },
      ],
    },
    devtool: 'nosources-source-map',
    infrastructureLogging: { level: 'log' },
  };

  /** @type WebpackConfig */
  const webviewConfig = {
    target: 'web',
    mode,
    entry: './webview-ui/src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist', 'webview'),
      filename: 'bundle.js',
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                configFile: path.resolve(__dirname, 'webview-ui', 'tsconfig.json'),
              },
            },
          ],
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
      }),
    ],
    devtool: 'nosources-source-map',
    infrastructureLogging: { level: 'log' },
  };

  return [extensionConfig, webviewConfig];
};
