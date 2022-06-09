import { Paperclips } from './paperclips';

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
const debugParam = urlParams.get('debug');

let DEBUG = debugParam !== null;

if (process.env.NODE_ENV !== 'production') {
    // Only runs in development and will be stripped in production builds.
    DEBUG = true;
}

let sketch;
let resizeTimeoutId;

window.addEventListener('load', () => {
    const canvas = document.body.querySelector('#c');
    const startButton = document.getElementById('start-button');

    /*let pane;
    if (DEBUG) {
        pane = new Pane({ title: 'Settings', expanded: false});
        pane.registerPlugin(EssentialsPlugin);
    }*/

    sketch = new Paperclips(canvas, null, (sketch) => {
        sketch.run(); 
    });

    startButton.onclick = () => {
        startButton.style.display = 'none';
        sketch.start();
    }
});

window.addEventListener('resize', () => {
    if (sketch) {
        if (resizeTimeoutId)
            clearTimeout(resizeTimeoutId);

        resizeTimeoutId = setTimeout(() => {
            resizeTimeoutId = null;
            sketch.resize();
        }, 300);
    }
});


