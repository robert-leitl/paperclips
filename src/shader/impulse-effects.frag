#version 300 es

precision highp float;

const int IMPULSE_BUFFER_SIZE = 5;

uniform sampler2D uColorTexture;
uniform vec4 uImpulseBuffer[IMPULSE_BUFFER_SIZE];
uniform float uFrames;

out vec4 outColor;

float easeOutQuint (float t) {
    return 1. + (--t) * t * t * t * t;
}

void main() {
    vec2 resolution = vec2(textureSize(uColorTexture, 0));
    vec2 aspect = resolution / max(resolution.x, resolution.y);
    vec2 uv = gl_FragCoord.xy / resolution;

    float impulseEffectOverlay = 1.;
    vec2 uvR = vec2(uv);
    vec2 uvG = vec2(uv);
    vec2 uvB = vec2(uv);

    for(int i=0; i<IMPULSE_BUFFER_SIZE; ++i) {
        vec4 impulseData = uImpulseBuffer[i];
        float progress = easeOutQuint(impulseData.z);
        vec2 dir = (uv * aspect) - (impulseData.xy * aspect);
        float dist = length(dir) * 1.5;
        float shockwaveStrength = smoothstep(progress + .1, progress + .15, dist) + (1. - smoothstep(progress, progress + .1, dist));
        impulseEffectOverlay -= (1. - shockwaveStrength) * (1. - smoothstep(0.5, 1., progress));
        shockwaveStrength = 1. - shockwaveStrength;
        float offset = shockwaveStrength * 0.07 * (1. - smoothstep(0.5, 1., progress));
        uvR -= normalize(dir) * offset * 1.;
        uvG -= normalize(dir) * offset * 1.1;
        uvB -= normalize(dir) * offset * 0.9;
    }

    outColor.r = texture(uColorTexture, uvR).r;
    outColor.g = texture(uColorTexture, uvG).g;
    outColor.b = texture(uColorTexture, uvB).b;
    outColor -= vec4((1. - impulseEffectOverlay) * .025);
}