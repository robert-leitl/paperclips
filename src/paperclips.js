import { mat4, quat, vec2, vec3 } from 'gl-matrix';
import { GLBBuilder } from './utils/glb-builder';
import * as AmmoStartFunc from './libs/ammo';
import { createAndSetupTexture, createFramebuffer, createProgram, makeBuffer, makeVertexArray, resizeCanvasToDisplaySize, setFramebuffer } from './utils/webgl-utils';

import tubeVertShaderSource from './shader/tube.vert';
import tubeFragShaderSource from './shader/tube.frag';
import { ArcballControl } from './utils/arcball-control';

export class Paperclips {
    oninit;

    #time = 0;
    #frames = 0;
    #deltaTime = 0;
    #isDestroyed = false;

    camera = {
        matrix: mat4.create(),
        near: 10,
        far: 50,
        distance: 20,
        orbit: quat.create(),
        position: vec3.create(),
        rotation: vec3.create(),
        up: vec3.fromValues(0, 1, 0)
    };

    animate = true;

    constructor(canvas, pane, oninit = null) {
        this.canvas = canvas;
        this.pane = pane;
        this.oninit = oninit;

        this.#init();
    }

    rigidBodies = [];
    tmpTrans = null;

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

        // update physics
        this.physicsWorld.stepSimulation(this.#deltaTime / 1000, 10);

        // Update rigid bodies
        //for (let i = 0; i < this.rigidBodies.length; i++) {
            const body = this.rigidBodies[0];
            const ms = body.getMotionState();
            if (ms) {
                ms.getWorldTransform(this.tmpTrans);
                const p = this.tmpTrans.getOrigin();
                const q = this.tmpTrans.getRotation();
                
                //mat4.translate(this.drawUniforms.worldMatrix, rotMat, vec3.fromValues(p.x(), p.y(), p.z()));
                //mat4.fromQuat(mat4.create(), quat.fromValues(q.x(), q.y(), q.z(), q.w()));
                mat4.fromRotationTranslation(this.drawUniforms.worldMatrix, quat.fromValues(q.x(), q.y(), q.z(), q.w()), vec3.fromValues(p.x(), p.y(), p.z()));
            }
        //}

        //this.control.update(this.#deltaTime);
        //mat4.fromQuat(this.drawUniforms.worldMatrix, this.control.rotationQuat);

        // update the world inverse transpose
        mat4.invert(this.drawUniforms.worldInverseTransposeMatrix, this.drawUniforms.worldMatrix);
        mat4.transpose(this.drawUniforms.worldInverseTransposeMatrix, this.drawUniforms.worldInverseTransposeMatrix);

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

        gl.uniformMatrix4fv(this.tubeLocations.uViewMatrix, false, this.drawUniforms.viewMatrix);
        gl.uniformMatrix4fv(this.tubeLocations.uProjectionMatrix, false, this.drawUniforms.projectionMatrix);
        gl.uniform3f(this.tubeLocations.uCameraPosition, this.camera.position[0], this.camera.position[1], this.camera.position[2]);
        gl.uniformMatrix4fv(this.tubeLocations.uWorldMatrix, false, this.drawUniforms.worldMatrix);
        gl.uniformMatrix4fv(this.tubeLocations.uWorldInverseTransposeMatrix, false, this.drawUniforms.worldInverseTransposeMatrix);
        gl.uniform1f(this.tubeLocations.uFrames, this.#frames);

        gl.bindVertexArray(this.tubeVAO);
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

        ///////////////////////////////////  LOAD RESOURCES

        this.glbBuilder = new GLBBuilder(gl);
        await this.glbBuilder.load(new URL('./assets/models/tube.glb', import.meta.url));
        console.log(this.glbBuilder);

        ///////////////////////////////////  Physics INITIALIZATION

        this.Ammo = await AmmoStartFunc();
        this.#initPhysics();

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
        
        // setup uniforms
        this.drawUniforms = {
            worldMatrix: mat4.create(),
            viewMatrix: mat4.create(),
            cameraMatrix: mat4.create(),
            projectionMatrix: mat4.create(),
            inversProjectionMatrix: mat4.create(),
            worldInverseTransposeMatrix: mat4.create()
        };

        /////////////////////////////////// GEOMETRY / MESH SETUP

        // create tube VAO
        this.tubePrimitive = this.glbBuilder.primitives.find(item => item.meshName == 'tube-simplified');
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

        // initial client dimensions
        const clientSize = vec2.fromValues(gl.canvas.clientWidth, gl.canvas.clientHeight);
        this.drawBufferSize = vec2.clone(clientSize);
        
        // init the pointer rotate control
        this.control = new ArcballControl(this.canvas);

        this.resize();

        this.camera.position[2] = this.camera.distance;
        this.#updateCameraMatrix();
        this.#updateProjectionMatrix(gl);

        this.initTweakpane();

        if (this.oninit) this.oninit(this);
    }

    #initPhysics() {
        const Ammo = this.Ammo;
        console.log(Ammo);

        // reused to get the transformations of rigid bodies
        this.tmpTrans = new Ammo.btTransform();

        const collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
        const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
        const overlappingPairCache = new Ammo.btDbvtBroadphase();
        const solver = new Ammo.btSequentialImpulseConstraintSolver();

        this.physicsWorld = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfiguration);
        this.physicsWorld.setGravity(new Ammo.btVector3(0, -19.810, 0));

        Ammo.btGImpactCollisionAlgorithm.prototype.registerAlgorithm(this.physicsWorld.getDispatcher());

        // create the environment enclosing box
        const envGroundShape = new Ammo.btStaticPlaneShape(new Ammo.btVector3(0, 1, 0), -5);
        envGroundShape.setMargin( 0.05 );
        const envGroundTransform = new Ammo.btTransform();
        envGroundTransform.setIdentity();
        envGroundTransform.setOrigin(new Ammo.btVector3( 0, 0, 0 ));
        let envGroundRbInfo = new Ammo.btRigidBodyConstructionInfo(0, new Ammo.btDefaultMotionState(envGroundTransform), envGroundShape, new Ammo.btVector3(0, 0, 0));
        let envGroundBody = new Ammo.btRigidBody(envGroundRbInfo);
        envGroundBody.setRestitution(.7);
        this.physicsWorld.addRigidBody(envGroundBody);

        /*let transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin( new Ammo.btVector3( 0, 0, 0 ) );
        let motionState = new Ammo.btDefaultMotionState( transform );
        let colShape = new Ammo.btBoxShape( new Ammo.btVector3( 10, 10, 10 ) );
        colShape.setMargin( 0.05 );
        let localInertia = new Ammo.btVector3( 0, 0, 0 );
        colShape.calculateLocalInertia( 1, localInertia );
        let rbInfo = new Ammo.btRigidBodyConstructionInfo( 1, motionState, colShape, localInertia );
        let body = new Ammo.btRigidBody( rbInfo );
        this.rigidBodies.push(body);
        this.physicsWorld.addRigidBody(body);*/

        // create the tube collision shape
        const mesh = new Ammo.btTriangleMesh(true, true);
        const tubeProxyPrimitive = this.glbBuilder.primitives.find(item => item.meshName == 'tube-proxy');
        const vertices = tubeProxyPrimitive.buffers.vertices.data;
        const indices = tubeProxyPrimitive.buffers.indices.data;
        for (let i = 0; i * 3 < indices.length; i++) {
            mesh.addTriangle(
                new Ammo.btVector3(vertices[indices[i * 3] * 3], vertices[indices[i * 3] * 3 + 1], vertices[indices[i * 3] * 3 + 2]),
                new Ammo.btVector3(vertices[indices[i * 3 + 1] * 3], vertices[indices[i * 3 + 1] * 3 + 1], vertices[indices[i * 3 + 1] * 3 + 2]),
                new Ammo.btVector3(vertices[indices[i * 3 + 2] * 3], vertices[indices[i * 3 + 2] * 3 + 1], vertices[indices[i * 3 + 2] * 3 + 2]),
                false
            );
        }
        this.tubeProxyShape = new Ammo.btGImpactMeshShape(mesh);
        this.tubeProxyShape.setMargin(0.01);
        this.tubeProxyShape.updateBound();

        this.#addTube();
    }

    #addTube() {
        const Ammo = this.Ammo;

        const mass = 0.1;
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(0, 0, 0));
        transform.setRotation(new Ammo.btQuaternion(0.0, -0.0, 0.5, 0.4999999701976776));
        const motionState = new Ammo.btDefaultMotionState(transform);
        const localInertia = new Ammo.btVector3(0, 0, 0);
        this.tubeProxyShape.calculateLocalInertia(mass, localInertia);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, this.tubeProxyShape, localInertia);
        const tubeBody = new Ammo.btRigidBody(rbInfo);
        console.log(tubeBody);
        tubeBody.setFriction(0.1);
        tubeBody.setRestitution(0.7);

        this.rigidBodies.push(tubeBody);
        this.physicsWorld.addRigidBody(tubeBody);
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
        mat4.invert(this.drawUniforms.viewMatrix, this.camera.matrix);
        mat4.copy(this.drawUniforms.cameraMatrix, this.camera.matrix);
    }

    #updateProjectionMatrix(gl) {
        const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
        mat4.perspective(this.drawUniforms.projectionMatrix, Math.PI / 4, aspect, this.camera.near, this.camera.far);
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
