#pragma glslify: reconstruct = require('./reconstruct-position.glsl')

float getRadius(float depth) {
    return clamp(depth, 0.0, 1.);
}

float getZPosition(vec2 uv, sampler2D depthTexture, mat4 inversProjectionMatrix, float scaleFactor) {
    float depth = tex(depthTexture, uv).r;
    vec3 viewPosition = reconstruct(uv, depth, inversProjectionMatrix);
    return (-viewPosition.z - 7. - (scaleFactor * .5)) / (scaleFactor * 0.2); // subtract the camera distance (7)
}

void blur(
    in vec2 A,
    in vec2 direction,
    in float scale,
    in float scaleFactor,
    in sampler2D inColorTexture,
    in sampler2D inDepthTexture,
    in mat4 inversProjectionMatrix,
    out vec4 outColor
) {
    const int KERNEL_SIZE = 6;
    float gaussian[KERNEL_SIZE];  
    gaussian[5] = 0.04153263993208;
    gaussian[4] = 0.06352050813141;
    gaussian[3] = 0.08822292796029;
    gaussian[2] = 0.11143948794984;
    gaussian[1] = 0.12815541114232;
    gaussian[0] = 0.13425804976814;

    vec4 resultColor = vec4(0.);
    float weightSum = 0.;

    // position of the current pixel
    vec2 texelSize = 1. / vec2(texSize(inColorTexture, 0));
    vec4 colorA = tex(inColorTexture, A);
    float depthA = getZPosition(A, inDepthTexture, inversProjectionMatrix, scaleFactor);
    float rA = getRadius(depthA);

    // scatter as you gather loop
    for(int i = -KERNEL_SIZE + 1; i < KERNEL_SIZE; ++i) {
        vec2 B = A + direction * ((float(i) * scale) * texelSize);
        vec4 colorB = tex(inColorTexture, B);
        float depthB = getZPosition(B, inDepthTexture, inversProjectionMatrix, scaleFactor);
        float rB = getRadius(depthB);

        float blurWeight = gaussian[abs(i)];

        // only consider if B is in front of A
        float bNearerWeight = clamp(abs(rA) - abs(rB) + 1., 0., .5);
        float weight = bNearerWeight * blurWeight;
        weightSum += weight;
        resultColor.rgb += colorB.rgb * weight;
    }

    // apply total weights
    resultColor.rgb /= weightSum;
    resultColor.a = colorA.a;

    outColor = resultColor;
}

#pragma glslify: export(blur)