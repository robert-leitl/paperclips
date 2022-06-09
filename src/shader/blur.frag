#version 300 es

precision highp float;

uniform sampler2D uColorTexture;
uniform sampler2D uDepthTexture;
uniform mat4 uInverseProjectionMatrix;
uniform float uScale;
uniform float uScaleFactor;
uniform vec2 uDirection;

out vec4 blurColor;

#pragma glslify: blur = require('./utils/blur.glsl', tex=texture, texSize=textureSize)

void main() {
    vec2 uv = gl_FragCoord.xy / vec2(textureSize(uColorTexture, 0));

    blur(
        uv,
        uDirection,
        uScale,
        uScaleFactor,
        uColorTexture,
        uDepthTexture,
        uInverseProjectionMatrix,
        blurColor
    );
}