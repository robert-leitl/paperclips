import { mat4, quat, vec3 } from 'gl-matrix';
import { GLBBuilder } from './utils/glb-builder';

export class PaperclipsPhysics {

    tubeBodies = [];
    transformInstance = null;
    impulse = {
        force: null,
        position: null
    };

    // callback for front plane collision events
    onFrontPlaneCollision = null;

    // define collision groups to apply raytests only to non-static objects
    envGroup = 0x01;
    objGroup = 0x02;
    rayGroup = 0x04;
    defaultMask = this.envGroup | this.objGroup;
    interactiveMask = this.envGroup | this.objGroup | this.rayGroup;
    rayMask = this.objGroup | this.rayGroup;

    FRONT_PLANE_COLLISION_DEBOUNCE_TIMEOUT = 200;
    MIN_COLLISION_LINEAR_VELOCITY = 4;
    frontPlaneCollisionTimeoutIds = new WeakMap();

    constructor(glb) {
        this.glb = glb;
    }

    async init(numTubes = 1, scale = 2, boundX, boundY) {
        const ammo = require('./libs/ammo');
        
        this.tubeScale = scale;

        this.Ammo = await ammo();
        const Ammo = this.Ammo;

        /** @type {GLBBuilder} */
        const glb = this.glb;

        // reused to get the transformations of rigid bodies
        this.transformInstance = new Ammo.btTransform();

        const collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
        const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
        const overlappingPairCache = new Ammo.btDbvtBroadphase();
        const solver = new Ammo.btSequentialImpulseConstraintSolver();

        this.physicsWorld = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfiguration);
        this.physicsWorld.setGravity(new Ammo.btVector3(0, -60, 0));

        //Ammo.btGImpactCollisionAlgorithm.prototype.registerAlgorithm(this.physicsWorld.getDispatcher());

        // create the environment enclosing box
        this.frontPlane = this.#addStaticPlaneBody('front', vec3.fromValues(0, 1, 0), 0);
        this.rightPlane = this.#addStaticPlaneBody('right', vec3.fromValues(1, 0, 0), -boundX);
        this.leftPlane = this.#addStaticPlaneBody('left', vec3.fromValues(-1, 0, 0), -boundX);
        this.topPlane = this.#addStaticPlaneBody('top', vec3.fromValues(0, 0, 1), -boundY);
        this.bottomPlane = this.#addStaticPlaneBody('bottom', vec3.fromValues(0, 0, -1), -boundY);
        this.backPlane = this.#addStaticPlaneBody('back', vec3.fromValues(0, -1, 0), -50);

        // create the tube concave collision shape
        const mesh = new Ammo.btTriangleMesh(true, true);
        const tubeProxyPrimitive = glb.getPrimitiveDataByMeshName('tube.concave.proxy');
        const vertices = tubeProxyPrimitive.buffers.vertices.data;
        const indices = tubeProxyPrimitive.buffers.indices.data;
        const triangleCount = indices.length / 3;
        for (let i = 0; i < triangleCount; i++) {
            mesh.addTriangle(
                new Ammo.btVector3(vertices[indices[i * 3 + 0] * 3], vertices[indices[i * 3 + 0] * 3 + 1], vertices[indices[i * 3 + 0] * 3 + 2]),
                new Ammo.btVector3(vertices[indices[i * 3 + 1] * 3], vertices[indices[i * 3 + 1] * 3 + 1], vertices[indices[i * 3 + 1] * 3 + 2]),
                new Ammo.btVector3(vertices[indices[i * 3 + 2] * 3], vertices[indices[i * 3 + 2] * 3 + 1], vertices[indices[i * 3 + 2] * 3 + 2]),
                false
            );
        }
        this.tubeGImpactMeshProxyShape = new Ammo.btGImpactMeshShape(mesh);
        this.tubeGImpactMeshProxyShape.setMargin(0.001);
        this.tubeGImpactMeshProxyShape.setLocalScaling(new Ammo.btVector3(this.tubeScale, this.tubeScale, this.tubeScale));
        this.tubeGImpactMeshProxyShape.updateBound();

        // create the tube compound collision shape made of convex hull shapes
        this.tubeCompoundProxyShape = new Ammo.btCompoundShape();
        const compoundPrimitives = glb.primitives.filter(item => item.meshName.indexOf('compound') !== -1);
        compoundPrimitives.forEach(({ buffers }) => {
            const shape = new Ammo.btConvexHullShape();
            const vertices = buffers.vertices.data;
            for (let i = 0; i < vertices.length / 3; i++) {
                shape.addPoint(new Ammo.btVector3(
                    vertices[i * 3 + 0], 
                    vertices[i * 3 + 1], 
                    vertices[i * 3 + 2]
                    ));
            }

            const transform = new Ammo.btTransform();
            transform.setIdentity();
            this.tubeCompoundProxyShape.addChildShape(transform, shape);
        });
        this.tubeCompoundProxyShape.setLocalScaling(new Ammo.btVector3(this.tubeScale, this.tubeScale, this.tubeScale));
        this.tubeCompoundProxyShape.setMargin(0.0001);
        

        // init interaction event handling
        this.impulse.force = new Ammo.btVector3(0, 1, 0);
        this.impulse.position = new Ammo.btVector3(0, 1, 0);

        for(let i=0; i<numTubes; ++i) {
            this.#addTubeBody(`tube.${i}`, Math.random() * 4 - 2, i * 10 + 5, Math.random() * 4 - 2);
        }
    }

    update(deltaTime) {
        this.physicsWorld.stepSimulation(deltaTime / 1000, 10);

        const bodyMatrices = [];

        for (let i = 0; i < this.tubeBodies.length; i++) {
            const body = this.tubeBodies[i];
            const ms = body.getMotionState();
            if (ms) {
                ms.getWorldTransform(this.transformInstance);
                const p = this.transformInstance.getOrigin();
                const q = this.transformInstance.getRotation();
                
                const matrix = mat4.fromRotationTranslation(mat4.create(), quat.fromValues(q.x(), q.y(), q.z(), q.w()), vec3.fromValues(p.x(), p.y(), p.z()));
                mat4.scale(matrix, matrix, vec3.fromValues(this.tubeScale, this.tubeScale, this.tubeScale));
                bodyMatrices.push(matrix);
            }
        }

        this.#detectCollision();

        return bodyMatrices;
    }

    getTubeBodyIndex(tubeBody) {
        return this.tubeBodies.findIndex(body => body === tubeBody);
    }

    getClosestRayHitTestResult(rayStart, rayEnd) {
        // test if a rigid body has been hit
        const rayStartWorldPosAmmoVec3 = new Ammo.btVector3(rayStart[0], rayStart[1], rayStart[2]);
        const rayEndWorldPosAmmoVec3 = new Ammo.btVector3(rayEnd[0], rayEnd[1], rayEnd[2]);
        const hitResult = new Ammo.ClosestRayResultCallback(rayStartWorldPosAmmoVec3, rayEndWorldPosAmmoVec3);
        hitResult.m_collisionFilterGroup = this.rayGroup;
        hitResult.m_collisionFilterMask = this.rayMask;
        this.physicsWorld.rayTest(
            rayStartWorldPosAmmoVec3, 
            rayEndWorldPosAmmoVec3, 
            hitResult
        );

        if (hitResult.hasHit()) {
            const Ammo = this.Ammo;

            const hitPos = hitResult.m_hitPointWorld;
            const hitWorldPos = vec3.fromValues(hitPos.x(), hitPos.y(), hitPos.z());
            const hitBody = Ammo.btRigidBody.prototype.upcast(hitResult.m_collisionObject);

            return {
                body: hitBody,
                position: hitWorldPos
            }
        }

        return null;
    }

    applyImpulse(body, position, force) {
        this.impulse.position.setX(position[0]);
        this.impulse.position.setY(position[1]);
        this.impulse.position.setZ(position[2]);
    
        this.impulse.force.setX(force[0]);
        this.impulse.force.setY(force[1]);
        this.impulse.force.setZ(force[2]);

        body.activate();
        body.applyImpulse(this.impulse.force, this.impulse.position);
    }

    #detectCollision() {
        const dispatcher = this.physicsWorld.getDispatcher();
        const numManifolds = dispatcher.getNumManifolds();
    
        for (let i = 0; i < numManifolds; i ++) {
    
            const contactManifold = dispatcher.getManifoldByIndexInternal(i);
            const numContacts = contactManifold.getNumContacts();

            const body0 = Ammo.btRigidBody.prototype.upcast(contactManifold.getBody0());
            const body1 = Ammo.btRigidBody.prototype.upcast(contactManifold.getBody1());
            const velocityLength0 = body0.getLinearVelocity().length()

            if (
                numContacts > 0 &&
                body1 === this.frontPlane && 
                this.tubeBodies.some(body => body === body0) &&
                velocityLength0 > this.MIN_COLLISION_LINEAR_VELOCITY
            ) {
                this.#triggerFrontPlaneCollisionEvent(body0, velocityLength0);
            }
        }
    }

    #triggerFrontPlaneCollisionEvent(tubeBody, strength) {
        if (!this.frontPlaneCollisionTimeoutIds.has(tubeBody)) {
            if (this.onFrontPlaneCollision) this.onFrontPlaneCollision(strength);

            this.frontPlaneCollisionTimeoutIds.set(
                tubeBody, 
                setTimeout(() => this.frontPlaneCollisionTimeoutIds.delete(tubeBody), this.FRONT_PLANE_COLLISION_DEBOUNCE_TIMEOUT)
            );
        }
    }

    #addStaticPlaneBody(name, normal, offset) {
        const Ammo = this.Ammo;

        const shape = new Ammo.btStaticPlaneShape(new Ammo.btVector3(normal[0], normal[1], normal[2]), offset);
        shape.setMargin(0.01);
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        let info = new Ammo.btRigidBodyConstructionInfo(
            0, 
            new Ammo.btDefaultMotionState(transform), 
            shape, 
            new Ammo.btVector3(0, 0, 0)
        );
        let body = new Ammo.btRigidBody(info);
        body.setRestitution(1);
        body.userData = { name };

        this.physicsWorld.addRigidBody(body, this.envGroup, this.defaultMask);

        return body;
    }

    #addTubeBody(name, x, y, z) {
        const Ammo = this.Ammo;

        const mass = 0.1;
        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new Ammo.btVector3(x, y, z));
        const motionState = new Ammo.btDefaultMotionState(transform);
        const localInertia = new Ammo.btVector3(0, 0, 0);
        this.tubeCompoundProxyShape.calculateLocalInertia(mass, localInertia);
        const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, this.tubeCompoundProxyShape, localInertia);
        const tubeBody = new Ammo.btRigidBody(rbInfo);
        tubeBody.setFriction(0.5);
        tubeBody.setRestitution(.7);
        tubeBody.userData = { name };

        this.tubeBodies.push(tubeBody);
        this.physicsWorld.addRigidBody(tubeBody, this.objGroup, this.interactiveMask);
    }
}