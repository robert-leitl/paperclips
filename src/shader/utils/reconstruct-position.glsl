// reconstructs the view space position given the screen space coordinates
// along with the depth
vec3 reconstructPosition(vec2 uv, float depth, mat4 inversProjectionMatrix) {
    float x = uv.x * 2. - 1.;   // = x / w
    float y = uv.y * 2. - 1.;   // = y / w
    float z = depth * 2. - 1.;
    vec4 projectedPosition = vec4(x, y, z, 1.);
    vec4 pos = inversProjectionMatrix * projectedPosition;
    return pos.xyz / pos.w;
}

#pragma glslify: export(reconstructPosition)