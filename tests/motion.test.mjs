import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { createMotionParameters, initializeMotion, applyVehicleForces, allocateTyrePair, C2_WORLD_SCALE } from "../src/physics/motion.ts";
const S = C2_WORLD_SCALE;
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const vector = (x=0,y=0,z=0) => new Vector3(x,y,z);
function mechanics(mass=2, comZ=0, rearGive=.08, frontGive=.12) {
  const wheel=(x,z,steerable,give)=>({type:0,identifier:"wheel",actor:"wheel",position:[x,0,z],positionFromActor:false,steerableFlag:+steerable,drivenFlag:+steerable,steerable,driven:steerable,suspensionGive:give,damping:.7,slippingFrictionReduction:.8,frictionAngles:[60,60],tractionMultiplier:1,rollingResistance:0});
  return { mechanicsVersion:1,minimumTurningCircle:1,brakeMultiplier:.8,brakingStrengthMultiplier:.6,gearCount:5,speedAtRedline:120,highestGearAcceleration:3,root:{type:"root",identifier:"root",actor:"root",jointType:"none",centerOfMass:[0,0,comZ],mass,inertiaDimensions:[.2,.1,.6],inertia:[mass*(.1**2+.6**2)/12,mass*(.2**2+.6**2)/12,mass*(.1**2+.2**2)/12],downforceBalanceSpeed:30},wheels:[wheel(-.1,.3,false,rearGive),wheel(.1,.3,false,rearGive),wheel(-.1,-.3,true,frontGive),wheel(.1,-.3,true,frontGive)],shapes:[{kind:"box",bounds:{min:[-.1,0,-.3],max:[.1,.15,.3]}}],subPartCount:0};
}
const neutral={throttle:0,steer:0,brake:0,handbrake:false};
function state(p,velocity=vector()) {return initializeMotion({position:vector(),orientation:new Quaternion(),velocity,angularVelocity:vector()},p);}
function staticRoad(p,friction=1,downforce=0) {
  const ride=p.wheelPositions[0].y;
  return {raycast(){return {distance:ride/S,normal:vector(0,1),friction,rollingResistance:0,downforce};}};
}
function preload(s,p) {s.wheelLengths.fill(p.wheelPositions[0].y);return s;}

test("original grouped axle parameters cross gives and normalize tyre angles by static wheel load",()=>{
  const source=mechanics(2,.06,.08,.12),p=createMotionParameters(source);
  const rearMass=2/(Math.abs((.3-.06)/(-.3-.06))+1);
  near(p.spring[0],rearMass*5/(.12*S));
  near(p.spring[1],(2-rearMass)*5/(.08*S));
  near(p.suspensionLength[0],(.01+.12)*S);
  near(p.suspensionLength[1],(.01+.08)*S);
  near(p.mu[0],Math.tan(60*157/9000)/4*Math.sqrt(rearMass*5));
  near(p.maxCurve,1/S);
  near(p.speedRevsRatio,120*4/9/5/6000);
  near(p.forceTorqueRatio,2*3*5);
  // Source driven flags intentionally point at the front; original groups by steerable.
  near(p.wheelPositions[0].z,.3*S);
});

test("static loads include COM axle distribution and cancel weight and pitch torque",()=>{
  const p=createMotionParameters(mechanics(2,.06)),s=preload(state(p),p);
  const d=applyVehicleForces(s,neutral,.04,p,staticRoad(p));
  const rearLoad=((- .3-.06)/(-.3-.3))*2*5;
  const frontLoad=((.3-.06)/(.3+.3))*2*5;
  near(d.wheelSpringLoads[0],rearLoad);near(d.wheelSpringLoads[1],rearLoad);
  near(d.wheelSpringLoads[2],frontLoad);near(d.wheelSpringLoads[3],frontLoad);
  near(d.force.length(),0);near(d.torque.length(),0);near(s.velocity.length(),0);
  assert.equal(d.grounded,4);
});

test("normal spring damper uses old length difference and clamps pulling force",()=>{
  const p=createMotionParameters(mechanics()),s=preload(state(p),p),dt=.04;
  const old=p.wheelPositions[0].y;
  s.wheelLengths[0]=old+.02;
  s.wheelLengths[1]=old-.02;
  const d=applyVehicleForces(s,neutral,dt,p,staticRoad(p));
  near(d.wheelSpringLoads[0],p.mass*2.5+p.damper[0]*.02/dt);
  near(d.wheelSpringLoads[1],Math.max(0,p.mass*2.5-p.damper[0]*.02/dt));
});

test("wheel capacities obey sqrt instantaneous load and linear road friction",()=>{
  const p=createMotionParameters(mechanics()),s=preload(state(p,vector(0,0,-2)),p);
  const d=applyVehicleForces(s,neutral,.04,p,staticRoad(p,.35));
  for(let i=0;i<4;i++)near(d.wheelCapacities[i],Math.sqrt(d.wheelSpringLoads[i])*p.mu[i<2?2:1]*.35);
  const second=preload(state(p,vector(0,0,-2)),p);
  second.wheelLengths[0]+=.03;
  const heavier=applyVehicleForces(second,neutral,.04,p,staticRoad(p,.35));
  near(heavier.wheelCapacities[0]/d.wheelCapacities[0],Math.sqrt(heavier.wheelSpringLoads[0]/d.wheelSpringLoads[0]));
});

test("pair saturation redistributes one sliding wheel then uses authored dynamic multiplier",()=>{
  for(const [d,l,r,el,er,slip] of [[5,3,9,2.4,7.6,false],[5,3,6,2.4,4.8,true],[5,3,4,2.4,3.2,true]]) {
    const result=allocateTyrePair(d,l,r,.8);near(result[0],el);near(result[1],er);assert.equal(result[2],slip);
  }
  assert.deepEqual(allocateTyrePair(2,3,4,.8),[2,2,false]);
});

test("dry force solver clips sideways demands at paired rear and front capacities",()=>{
  const p=createMotionParameters(mechanics()),s=preload(state(p,vector(3,0,-2)),p);
  const d=applyVehicleForces(s,neutral,.04,p,staticRoad(p,.1));
  assert.equal(s.slipping,3);
  for(let i=0;i<4;i++)near(d.wheelTyreForces[i],d.wheelCapacities[i]*p.slipMultiplier);
  assert.ok(d.force.x<0);
  assert.ok(s.velocity.x<3);
});

test("inertia, contact lever arm and orientation preserve world/body transformation",()=>{
  const p=createMotionParameters(mechanics()),a=preload(state(p,vector(1,0,-2)),p);
  a.curvature=.01;
  const q=new Quaternion().setFromAxisAngle(vector(0,1),Math.PI/2);
  const b=preload(state(p,a.velocity.clone().applyQuaternion(q)),p);b.orientation.copy(q);b.curvature=a.curvature;
  const da=applyVehicleForces(a,{...neutral,steer:.25},.04,p,staticRoad(p));
  const db=applyVehicleForces(b,{...neutral,steer:.25},.04,p,staticRoad(p));
  near(db.force.distanceTo(da.force),0,1e-7);
  near(b.velocity.distanceTo(a.velocity.clone().applyQuaternion(q)),0,1e-7);
  near(b.angularVelocity.distanceTo(a.angularVelocity.clone().applyQuaternion(q)),0,1e-7);
  assert.ok(a.angularVelocity.length()>0);
});

test("drivetrain launches through neutral rev buildup and drives the non-steer axle",()=>{
  const p=createMotionParameters(mechanics()),s=preload(state(p),p);
  const road=staticRoad(p);
  for(let i=0;i<9;i++)applyVehicleForces(s,{...neutral,throttle:1},.04,p,road);
  assert.equal(s.gear,1);assert.ok(s.rpm>1000);
  const d=applyVehicleForces(s,{...neutral,throttle:1},.04,p,road);
  assert.ok(d.axleForces[0].z<0);near(d.axleForces[1].z,0);
  assert.ok(s.velocity.z<0);
});

test("brakes ramp from original mass-scaled initial force and oppose forward travel",()=>{
  const p=createMotionParameters(mechanics()),s=preload(state(p,vector(0,0,-3)),p);
  const first=applyVehicleForces(s,{...neutral,brake:1},.04,p,staticRoad(p));
  near(s.brakeForce,p.initialBrake);assert.ok(first.force.z>0);
  const previous=s.velocity.z;
  applyVehicleForces(s,{...neutral,brake:1},.04,p,staticRoad(p));
  near(s.brakeForce,p.initialBrake+.04*p.brakeIncrease);assert.ok(s.velocity.z>previous);
  applyVehicleForces(s,neutral,.04,p,staticRoad(p));near(s.brakeForce,0);
});

test("gravity and linear capped downforce use original scale with no generic damping",()=>{
  const p=createMotionParameters(mechanics()),s=state(p);
  const air=applyVehicleForces(s,neutral,.04,p,{raycast:()=>null});
  assert.equal(air.grounded,0);near(air.force.y,-p.mass*10);
  // Air drag is negligible here but included analytically after gravity.
  const gravityVelocity=-10*.04/S;
  near(s.velocity.y,gravityVelocity*(1-Math.abs(gravityVelocity)*.04*.0005000000237487257*S/p.mass));
  const atSpeed=(speed)=>{const x=preload(state(p,vector(0,0,-speed/S)),p);return applyVehicleForces(x,neutral,.04,p,staticRoad(p,1,1));};
  near(atSpeed(5).downforce,p.mass*10*5/30);
  near(atSpeed(10).downforce,2*atSpeed(5).downforce);
  near(atSpeed(60).downforce,p.mass*10);
});

test("mass scaling preserves spring-supported acceleration and tyre force per mass",()=>{
  const a=createMotionParameters(mechanics(2)),b=createMotionParameters(mechanics(8));
  const sa=preload(state(a,vector(1,0,-2)),a),sb=preload(state(b,vector(1,0,-2)),b);
  const da=applyVehicleForces(sa,neutral,.04,a,staticRoad(a));
  const db=applyVehicleForces(sb,neutral,.04,b,staticRoad(b));
  for(let i=0;i<4;i++){near(db.wheelSpringLoads[i],4*da.wheelSpringLoads[i]);near(db.wheelCapacities[i],4*da.wheelCapacities[i]);}
  near(db.force.x/b.mass,da.force.x/a.mass);
});
