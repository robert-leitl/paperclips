import { mat4, quat, vec2, vec3, vec4 } from 'gl-matrix';
import { GLBBuilder } from './utils/glb-builder';
import { createAndSetupTexture, createFramebuffer, createProgram, makeBuffer, makeVertexArray, resizeCanvasToDisplaySize, setFramebuffer } from './utils/webgl-utils';

import tubeVertShaderSource from './shader/tube.vert';
import tubeFragShaderSource from './shader/tube.frag';
import { ArcballControl } from './utils/arcball-control';
import { PaperclipsPhysics } from './paperclips-physics';

export class Paperclips {
    oninit;

    #time = 0;
    #frames = 0;
    #deltaTime = 0;
    #isDestroyed = false;

    camera = {
        matrix: mat4.create(),
        near: 1,
        far: 30,
        fov: Math.PI / 3,
        aspect: 1,
        position: vec3.fromValues(0, -7, 0),
        up: vec3.fromValues(0, 0, 1),
        matrices: {
            view: mat4.create(),
            projection: mat4.create(),
            inversProjection: mat4.create()
        }
    };

    DEFAULT_TUBE_SCALE = 3;
    TUBE_COUNT = 2;

    constructor(canvas, pane, oninit = null) {
        this.canvas = canvas;
        this.pane = pane;
        this.oninit = oninit;

        this.#init();
    }

    resize() {
        const gl = this.gl;

        const needsResize = resizeCanvasToDisplaySize(gl.canvas);
        
        if (needsResize) {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            this.#resizeTextures(gl);
        }

        this.#updateProjectionMatrix(gl);
    }

    run(time = 0) {
        if(this.fpsGraph) this.fpsGraph.begin();

        this.#deltaTime = Math.min(32, time - this.#time);
        this.#time = time;

        // update physics and apply motion states
        this.bodyMatrices = this.physics.update(this.#deltaTime);

        if (this.animate)
            this.#frames += this.#deltaTime / 16;

        if (this.#isDestroyed) return;

        this.#render();

        if(this.fpsGraph) this.fpsGraph.end();

        requestAnimationFrame((t) => this.run(t));
    }

    #render() {
        /** @type {WebGLRenderingContext} */
        const gl = this.gl;

        gl.useProgram(this.tubeProgram);

        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);

        gl.uniformMatrix4fv(this.tubeLocations.uViewMatrix, false, this.camera.matrices.view);
        gl.uniformMatrix4fv(this.tubeLocations.uProjectionMatrix, false, this.camera.matrices.projection);
        gl.uniform3f(this.tubeLocations.uCameraPosition, this.camera.position[0], this.camera.position[1], this.camera.position[2]);
        gl.uniform1f(this.tubeLocations.uFrames, this.#frames);
        gl.bindVertexArray(this.tubeVAO);
        this.bodyMatrices.forEach(matrix => this.#renderTube(matrix));
    }

    #renderTube(matrix) {
        /** @type {WebGLRenderingContext} */
        const gl = this.gl;

        // update the world inverse transpose
        const worldInverseTranspose = mat4.invert(mat4.create(), matrix);
        mat4.transpose(worldInverseTranspose, worldInverseTranspose);

        gl.uniformMatrix4fv(this.tubeLocations.uWorldMatrix, false, matrix);
        gl.uniformMatrix4fv(this.tubeLocations.uWorldInverseTransposeMatrix, false, worldInverseTranspose);
        gl.drawElements(gl.TRIANGLES, this.tubeBuffers.indices.length, gl.UNSIGNED_SHORT, 0);
    }

    destroy() {
        this.#isDestroyed = true;
    }

    async #init() {
        this.gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false });

        /** @type {WebGLRenderingContext} */
        const gl = this.gl;

        if (!gl) {
            throw new Error('No WebGL 2 context!')
        }

        if (!gl.getExtension("EXT_color_buffer_float")) {
            console.error("FLOAT color buffer not available");
            document.body.innerHTML = "This example requires EXT_color_buffer_float which is unavailable on this system."
        }

        // initial client dimensions
        const clientSize = vec2.fromValues(gl.canvas.clientWidth, gl.canvas.clientHeight);
        this.drawBufferSize = vec2.clone(clientSize);

        ///////////////////////////////////  LOAD RESOURCES

        this.glbBuilder = new GLBBuilder(gl);
        await this.glbBuilder.load(new URL('./assets/models/tube.glb', import.meta.url));

        ///////////////////////////////////  Physics INITIALIZATION

        this.physics = new PaperclipsPhysics(this.glbBuilder);
        // get the places of the bounds of physics world
        const boundY = Math.tan(this.camera.fov / 2) * (-this.camera.position[1] + 1);
        const boundX = boundY * (gl.canvas.clientWidth / gl.canvas.clientHeight);
        const tubeScale = Math.min(gl.canvas.clientWidth, gl.canvas.clientHeight) / 250;
        await this.physics.init(this.TUBE_COUNT, tubeScale, boundX, boundY);

        ///////////////////////////////////  PROGRAM SETUP

        // setup programs
        this.tubeProgram = createProgram(gl, [tubeVertShaderSource, tubeFragShaderSource], null, { aModelPosition: 0, aModelNormal: 1 });

        // find the locations
        this.tubeLocations = {
            aModelPosition: gl.getAttribLocation(this.tubeProgram, 'aModelPosition'),
            aModelNormal: gl.getAttribLocation(this.tubeProgram, 'aModelNormal'),
            uWorldMatrix: gl.getUniformLocation(this.tubeProgram, 'uWorldMatrix'),
            uViewMatrix: gl.getUniformLocation(this.tubeProgram, 'uViewMatrix'),
            uProjectionMatrix: gl.getUniformLocation(this.tubeProgram, 'uProjectionMatrix'),
            uWorldInverseTransposeMatrix: gl.getUniformLocation(this.tubeProgram, 'uWorldInverseTransposeMatrix'),
            uCameraPosition: gl.getUniformLocation(this.tubeProgram, 'uCameraPosition'),
            uFrames: gl.getUniformLocation(this.tubeProgram, 'uFrames')
        };
    
        /////////////////////////////////// GEOMETRY / MESH SETUP

        // create tube VAO
        this.tubePrimitive = this.glbBuilder.getPrimitiveDataByMeshName('tube');
        this.tubeBuffers = this.tubePrimitive.buffers;
        this.tubeVAO = makeVertexArray(gl, [
            [this.tubeBuffers.vertices.webglBuffer, 0, this.tubeBuffers.vertices.numberOfComponents],
            [this.tubeBuffers.normals.webglBuffer, 1, this.tubeBuffers.normals.numberOfComponents]
        ], this.tubeBuffers.indices.webglBuffer);

        // create quad VAO
        const quadPositions = [-1, -1, 3, -1, -1, 3];
        this.quadBuffers = {
            position: makeBuffer(gl, new Float32Array(quadPositions), gl.STATIC_DRAW),
            numElem: quadPositions.length / 2
        };
        this.quadVAO = makeVertexArray(gl, [[this.quadBuffers.position, 0, 2]]);

        /////////////////////////////////// FRAMEBUFFER SETUP

        // init the pointer rotate control
        //this.control = new ArcballControl(this.canvas);

        this.resize();

        this.#initEventHandling();
        this.#updateCameraMatrix();
        this.#updateProjectionMatrix(gl);

        this.initTweakpane();

        if (this.oninit) this.oninit(this);
    }

    #initEventHandling() {
        // add click handler to canvas to apply impulses for the tubes
        this.canvas.addEventListener('click', (e) => {
            // calculate the clicked point on the far plane
            const worldPos = this.screenToWorldPosition(e.clientX, e.clientY, 1 /* camera far plane */);

            // test if a rigid body has been hit
            const rayStartWorldPos = vec3.clone(this.camera.position);
            const rayEndWorldPos = worldPos;
            const result = this.physics.getClosestRayHitTestResult(rayStartWorldPos, rayEndWorldPos);

            if (result) {
                // get the corresponding tube graphics body
                const modelMatrix = this.bodyMatrices[this.physics.getTubeBodyIndex(result.body)];

                // transform the hit position from world to model space
                const inversModelMatrix = mat4.invert(mat4.create(), modelMatrix);
                const position = vec3.transformMat4(vec3.create(), result.position, inversModelMatrix);

                // calculate the force vector from the click position
                const x = (screenX / this.canvas.clientWidth) * 2 - 1;
                const y = (1 - (screenY / this.canvas.clientHeight)) * 2 - 1;
                const force = vec3.fromValues(-1 * x, 2, -1 * y);
                vec3.normalize(force, force);
                vec3.scale(force, force, 5);
                
                this.physics.applyImpulse(result.body, position, force);
            }
        }); 
    }

    screenToWorldPosition(screenX, screenY, z) {
        const x = (screenX / this.canvas.clientWidth) * 2 - 1;
        const y = (1 - (screenY / this.canvas.clientHeight)) * 2 - 1;
        const ndcPos = vec3.fromValues(x, y, z); 
        const inversViewProjectionMatrix = mat4.multiply(mat4.create(), this.camera.matrix, this.camera.matrices.inversProjection);
        const worldPos = vec4.transformMat4(vec4.create(), vec4.fromValues(ndcPos[0], ndcPos[1], ndcPos[2], 1), inversViewProjectionMatrix);
        if (worldPos[3] !== 0){
            vec4.scale(worldPos, worldPos, 1 / worldPos[3]);
        }

        return worldPos;
    }

    #resizeTextures(gl) {
        const clientSize = vec2.fromValues(gl.canvas.clientWidth, gl.canvas.clientHeight);
        this.drawBufferSize = vec2.clone(clientSize);
        
        /*this.#resizeTexture(gl, this.plantColorTexture, gl.RGBA, clientSize);
        this.#resizeTexture(gl, this.plantDepthTexture, gl.DEPTH_COMPONENT32F, clientSize);
        this.#resizeTexture(gl, this.deltaDepthColorTexture, gl.RGBA, clientSize);
        this.#resizeTexture(gl, this.hBlurTexture, gl.RGBA, clientSize);
        this.#resizeTexture(gl, this.vBlurTexture, gl.RGBA, clientSize);*/

        // reset bindings
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    #resizeTexture(gl, texture, format, size) {
        gl.bindTexture(gl.TEXTURE_2D, texture);

        if (format === gl.RGBA) 
            gl.texImage2D(gl.TEXTURE_2D, 0, format, size[0], size[1], 0, format, gl.UNSIGNED_BYTE, null);
        else if (format === gl.DEPTH_COMPONENT32F) 
            gl.texImage2D(gl.TEXTURE_2D, 0, format, size[0], size[1], 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);

        gl.bindTexture(gl.TEXTURE_2D, null);
    }

    #updateCameraMatrix() {
        mat4.targetTo(this.camera.matrix, this.camera.position, [0, 0, 0], this.camera.up);
        mat4.invert(this.camera.matrices.view, this.camera.matrix);
    }

    #updateProjectionMatrix(gl) {
        this.camera.aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        mat4.perspective(this.camera.matrices.projection, this.camera.fov, this.camera.aspect, this.camera.near, this.camera.far);
        mat4.invert(this.camera.matrices.inversProjection, this.camera.matrices.projection);
    }

    initTweakpane() {
        if (this.pane) {
            const maxFar = 200;

            this.fpsGraph = this.pane.addBlade({
                view: 'fpsgraph',
                label: 'fps',
                lineCount: 1,
                maxValue: 120,
                minValue: 0
            });

            //this.pane.addInput(this, 'animate', { label: 'animate plant' });

            //const cameraFolder = this.pane.addFolder({ title: 'Camera' });
            //this.#createTweakpaneSlider(cameraFolder, this.camera, 'near', 'near', 1, maxFar, null, () => this.#updateProjectionMatrix(this.gl));
            //this.#createTweakpaneSlider(cameraFolder, this.camera, 'far', 'far', 1, maxFar, null, () => this.#updateProjectionMatrix(this.gl));

            /*const particlesFolder = this.pane.addFolder({ title: 'Particles' });
            this.#createTweakpaneSlider(particlesFolder, this.particles.settings, 'velocity', 'velocity', 0, 10, null);
            this.#createTweakpaneSlider(particlesFolder, this.particles.settings, 'curl', 'curl', 0, 10, null);
            this.#createTweakpaneSlider(particlesFolder, this.particles.settings, 'noise', 'noise', 0, 10, null);

            const refractionFolder = this.pane.addFolder({ title: 'Refraction' });
            this.#createTweakpaneSlider(refractionFolder, this.refractionSettings, 'strength', 'strength', 0, 1, null);
            this.#createTweakpaneSlider(refractionFolder, this.refractionSettings, 'dispersion', 'dispersion', 0, 10, null);*/

            //const plantFolder = this.pane.addFolder({ title: 'Plant' });
            /*const plantGenerateBtn = plantFolder.addButton({ title: 'generate' });
            plantGenerateBtn.on('click', () => this.plant.generate(this.#frames));*/
        }
    }

    #createTweakpaneSlider(folder, obj, propName, label, min, max, stepSize = null, callback) {
        const slider = folder.addBlade({
            view: 'slider',
            label,
            min,
            max,
            step: stepSize,
            value: obj[propName],
        });
        slider.on('change', e => {
            obj[propName] = e.value;
            if(callback) callback();
        });
    }
}
