import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'../../tests/konva',
  fullyParallel:true,
  workers:2,
  reporter:[['list'],['json',{outputFile:'../../tmp/konva-report.json'}]],
  outputDir:'../../test-results/konva',
  use:{baseURL:'http://127.0.0.1:3102',trace:'retain-on-failure'},
  projects:[
    {name:'desktop-dpr1',use:{...devices['Desktop Chrome'],viewport:{width:1100,height:900},deviceScaleFactor:1}},
    {name:'mobile-dpr2',use:{...devices['Pixel 7'],deviceScaleFactor:2}},
  ],
  webServer:{command:'npm run lab:konva:start',url:'http://127.0.0.1:3102',reuseExistingServer:false,timeout:60000},
});
