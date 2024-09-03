const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const https = require('https');

// Define the file sizes and the URLs for regular and streamed downloads
const fileSizes = ['100MB', '250MB', '500MB', '1GB'];
const baseURL = 'https://13.59.58.254/files';
const downloadType = ['download', 'stream'];
const results = [];

// Number of test runs (N samples)
const testRuns = 10;

// The networkConditions object contains conditions from 1 Gbps down to 1 Mbps
const networkConditions = {};

// Define the range and steps
const maxSpeedMbps = 500; // Maximum speed in Mbps
const minSpeedMbps = 10;  // Minimum speed in Mbps
const step = 50;         // Step size in Mbps

// Create network conditions
for (let speed = maxSpeedMbps; speed >= minSpeedMbps; speed -= step) {
    const speedKey = `${speed} Mbps`;
    networkConditions[speedKey] = {
        offline: false,
        downloadThroughput: (speed * 1024 * 1024) / 8, // Convert Mbps to bytes per second
        uploadThroughput: (speed * 1024 * 1024) / 8,   // Symmetrical speeds
        latency: speed === 1000 ? 10 : 20 + ((maxSpeedMbps - speed) / step) // example dynamic latency
    };
}

// Explicitly handle the minimum speed
networkConditions[`${minSpeedMbps} Mbps`] = {
    offline: false,
    downloadThroughput: (minSpeedMbps * 1024 * 1024) / 8, // Convert Mbps to bytes per second
    uploadThroughput: (minSpeedMbps * 1024 * 1024) / 8,   // Symmetrical speeds
    latency: 20 + ((maxSpeedMbps - minSpeedMbps) / step) // example dynamic latency
};

// Function to get file size by sending a HEAD request
async function getFileSize(url) {
    try {
        const response = await axios.head(url);
        return parseInt(response.headers['content-length'], 10);
    } catch (error) {
        throw new Error(`Failed to get file size for ${url}: ${error.message}`);
    }
}

async function downloadChunk(url, start, end, chunkIndex) {
    console.log(`Downloading chunk ${chunkIndex}: ${url} [Range: bytes=${start}-${end}]`);

    try {
        // const response = await axios.get(`${url}`, {
        //     headers: { Foo: `bytes=${start}-${end}` },
        //     responseType: 'arraybuffer',
        // });
        const response = await axios.get(`${url}`, {
            headers: {
                'Accept': '*/*',
                'User-Agent': 'DownloadTest/Axios',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Range': `${start}-${end}`
            },
            responseType: 'arraybuffer'
        });

        console.log(`Chunk ${chunkIndex} downloaded successfully [Status: ${response.status}]`);
        return { data: response.data, chunkIndex };
    } catch (error) {
        if (error.response && error.response.data) {
            console.error(`Error downloading chunk ${chunkIndex}:`, error.response.data.toString('utf8'));
        } else {
            console.error(`Error downloading chunk ${chunkIndex}:`, error.message);
        }
        throw error;
    }
}

// Function to download a file in chunks
async function downloadFileInChunks(url, filePath, chunkSize = 1024 * 1024 * 10) { // 10MB chunk size
    const fileSize = await getFileSize(url);
    const numChunks = Math.ceil(fileSize / chunkSize);

    console.log(`File size for ${url} is ${fileSize} bytes and will be chunked by ${numChunks}`);

    const chunkPromises = [];
    for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize - 1, fileSize - 1);
        chunkPromises.push(downloadChunk(url, start, end, i));
    }

    const chunks = await Promise.all(chunkPromises);

    // Write chunks to file
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex); // Ensure chunks are in the correct order
    const file = fs.createWriteStream(filePath);
    chunks.forEach(chunk => file.write(chunk.data));
    file.end();
}

async function goto(page, link) {
    return page.evaluate((link) => {
        location.href = link;
    }, link);
}

async function waitForDownload(downloadPath, timeout = 600000) {
    return new Promise((resolve, reject) => {
        const checkInterval = 1000; // Check every second
        const start = Date.now();
        
        const interval = setInterval(() => {
            if (fs.existsSync(downloadPath)) {
                clearInterval(interval);
                resolve();
            }
            if (Date.now() - start > timeout) {
                clearInterval(interval);
                reject(new Error("Download timed out"));
            }
        }, checkInterval);
    });
}

(async () => {
    const browser = await puppeteer.launch({
        headless: true,
        ignoreHTTPSErrors: true, // Ignore HTTPS errors
        args: ['--ignore-certificate-errors']
    });

    const page = await browser.newPage();

    for (let run = 0; run < testRuns; run++) {
        for (const [speedKey, condition] of Object.entries(networkConditions)) {
            for (const downloadTypeUrl of downloadType) {
                for (const size of fileSizes) {
                    const downloadFileName = `${size}.bin`;
                    const downloadedFilePath = path.resolve(__dirname, 'downloads', downloadFileName);
                    
                    console.log(`Testing with network condition: ${speedKey} (Run ${run + 1}/${testRuns}) for URL: ${baseURL}/${downloadTypeUrl}/${downloadFileName}`);
                    const client = await page.createCDPSession();
                    await client.send('Network.emulateNetworkConditions', condition);

                    await client.send("Browser.setDownloadBehavior", {
                        behavior: "allow",
                        downloadPath: path.resolve(__dirname, 'downloads'),
                        eventsEnabled: true,
                    });

                    try {
                        await client.send('Network.clearBrowserCache');

                        const startTime = Date.now();

                        await goto(page, `${baseURL}/${downloadTypeUrl}/${downloadFileName}/`);
                        await waitForDownload(downloadedFilePath);

                        const endTime = Date.now();
                        const duration = (endTime - startTime) / 1000; // Convert to seconds

                        console.log(`Download for ${baseURL}/${downloadTypeUrl}/${downloadFileName} completed in ${duration}s`);

                        results.push({ url: `${baseURL}/${downloadTypeUrl}/${downloadFileName}`, speed: speedKey, run: run + 1, duration });

                        // Delete the downloaded file to avoid collision in future runs
                        fs.unlinkSync(downloadedFilePath);
                        console.log(`Deleted file: ${downloadedFilePath}`);

                    } catch (error) {
                        console.error(`Error during download test: ${error}`);
                    } finally {
                        await client.send('Network.disable');
                    }
                }
            }
        }
    }

    const csvFilePath = path.join(__dirname, 'download_times.csv');
    const csvHeader = 'URL,Speed,Run,Duration (s)\n';
    const csvContent = results.map(result => `${result.url},${result.speed},${result.run},${result.duration}`).join('\n');
    fs.writeFileSync(csvFilePath, csvHeader + csvContent, 'utf8');
    console.log(`Results saved to ${csvFilePath}`);

    await browser.close();
})();
