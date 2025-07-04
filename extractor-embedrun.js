import fetch from 'node-fetch';

// Function to get stream data
async function getStreamData(id) {
    const response = await fetch(`https://embedrun.store/get-stream?id=${encodeURIComponent(id)}`);
    if (!response.ok) {
        throw new Error('Failed to fetch stream data');
    }
    return await response.json();
}

// Function to extract .m3u8 URL
async function extractM3U8(url) {
    const match = url.match(/embed\/([^\/]+)/);
    if (!match) {
        console.error('Invalid URL format. Please provide a valid EmbedRun URL.');
        return;
    }

    const videoID = match[1];

    try {
        const data = await getStreamData(videoID);
        if (!data || !data.pointer) {
            console.error('Stream data not found');
            return;
        }

        const channelID = data.pointer;
        const m3u8URL = `https://ses.welovestroll.store/${channelID}/index.m3u8`;

        console.log(`.m3u8 URL: ${m3u8URL}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

// Get the URL from command line arguments
const url = process.argv[2];
if (!url) {
    console.error('Please provide an EmbedRun URL as an argument.');
    process.exit(1);
}

// Call the extractM3U8 function
extractM3U8(url);
