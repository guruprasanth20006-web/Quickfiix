const supabase = require('./supabase');

async function test() {
  console.log("Testing users insert...");
  const phone = '1234567890';
  const name = 'Test User';
  
  const { data: userData, error: userErr } = await supabase
    .from('users')
    .upsert({ phone, name }, { onConflict: 'phone' })
    .select();
    
  console.log("User Error:", userErr);
  console.log("User Data:", userData);

  if (!userErr) {
    console.log("Testing guardians insert...");
    const guardiansToInsert = [{
      id: '123e4567-e89b-12d3-a456-426614174000',
      user_phone: phone,
      name: 'Guardian Test',
      email: 'test@example.com',
      phone: '0987654321'
    }];
    
    const { data: gData, error: gErr } = await supabase
      .from('guardians')
      .insert(guardiansToInsert)
      .select();
      
    console.log("Guardian Error:", gErr);
    console.log("Guardian Data:", gData);
  }
}

test();
