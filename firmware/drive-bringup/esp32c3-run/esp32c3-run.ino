// ESP32-C3 - continuous motor run for the battery-toggle test.
// Drives BOTH motors gently forward so movement appears when you flick the
// battery on. Serial: s=stop  f=both fwd  b=both back  l=left only  r=right only
// WARNING: PROP THE ROBOT SO THE WHEELS ARE OFF THE TABLE - it will drive forward.
const int L_RPWM=4, L_LPWM=5, R_RPWM=6, R_LPWM=7;
const int PWM_FREQ=1000, PWM_RES=8;
const float DEADBAND=0.05f;
float SPEED=0.30f;
// Per-side trim to drive straight (open-loop, no encoders). Right motor spins
// faster, so R_TRIM<1 slows it to match the left. TUNE: if it still curves LEFT
// lower R_TRIM; if it curves RIGHT raise it (toward 1.0).
const float L_TRIM=1.00f, R_TRIM=0.96f;
void writeMotor(int rp,int lp,float v){
  if(v>-DEADBAND&&v<DEADBAND)v=0;
  int d=(int)(fabs(v)*255.0f); if(d>255)d=255;
  if(v>0){ledcWrite(rp,d);ledcWrite(lp,0);}
  else if(v<0){ledcWrite(rp,0);ledcWrite(lp,d);}
  else{ledcWrite(rp,0);ledcWrite(lp,0);}
}
void drive(float l,float r){writeMotor(L_RPWM,L_LPWM,l*L_TRIM);writeMotor(R_RPWM,R_LPWM,r*R_TRIM);}
void setup(){
  Serial.begin(115200);
  ledcAttach(L_RPWM,PWM_FREQ,PWM_RES); ledcAttach(L_LPWM,PWM_FREQ,PWM_RES);
  ledcAttach(R_RPWM,PWM_FREQ,PWM_RES); ledcAttach(R_LPWM,PWM_FREQ,PWM_RES);
  drive(0,0);
  Serial.println("\n=== C3 continuous run ===  PROP WHEELS OFF THE TABLE");
  Serial.println("BOTH FORWARD in 3s. keys: s=stop f=fwd b=back l=left r=right");
  for(int i=3;i>0;i--){Serial.printf(" %d...\n",i);delay(1000);}
  drive(SPEED,SPEED);
  Serial.println("driving BOTH FORWARD - toggle battery to see movement");
}
void loop(){
  if(!Serial.available())return;
  switch(Serial.read()){
    case 's': drive(0,0);          Serial.println("STOP"); break;
    case 'f': drive(SPEED,SPEED);  Serial.println("both fwd"); break;
    case 'b': drive(-SPEED,-SPEED);Serial.println("both back"); break;
    case 'l': drive(SPEED,0);      Serial.println("left only"); break;
    case 'r': drive(0,SPEED);      Serial.println("right only"); break;
  }
}
