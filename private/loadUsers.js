require('dotenv').config({ path: '../.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');

// Initialize Supabase client with service key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    db: {
      schema: 'public'
    }
  }
);

async function loadUsers(filename = 'users.json') {
  try {
    // Read users from JSON file
    const usersData = JSON.parse(
      await fs.readFile(path.join(__dirname, filename), 'utf8')
    );

    // Process users
    const testUsers = usersData;
    
    for (const userData of testUsers) {
      if (!userData.phone || !userData.active) continue;
      console.log(`Processing user: ${userData.phone} ${userData.email}`);
      
      // Check if user exists by phone or email
      userData.email = (userData.email || `${userData.phone}@placeholder.com`).toLowerCase();
      const { data: existingUser, error: searchError } = await supabase
        .rpc('search_auth_user', {
          p_phone: userData.phone,
          p_email: userData.email
        })
        .single();

      if (searchError && !searchError.details.includes('0 rows')) {
        console.error('Error searching user:', searchError);
        continue;
      }

      let userId;
      
      if (!existingUser) {
        console.log('No user found by phone or email');
        // Create new user in auth.users
        const { data: { user }, error: authError } = await supabase.auth.admin.createUser({
          email: userData.email,
          phone: userData.phone,
          user_metadata: {
            external_id: userData.id,
            external_service: 'barzo',
            external_env: process.env.NODE_ENV || 'development'
          }
        });

        if (authError && !authError.message.includes('already exists')) {
          console.error('Error creating auth user:', authError);
          continue;
        }

        userId = user?.id;
      } else {
        console.log(`Found existing user: ${JSON.stringify(existingUser)}`);
        userId = existingUser.id;
        
        // Update phone/email if needed
        if (existingUser.phone !== userData.phone.replace('+','')) {
          console.log('updating phone number from', existingUser.phone, 'to', userData.phone);
          const { error } = await supabase.auth.admin.updateUserById(
            userId,
            { phone: userData.phone }
          );
          if (error) console.error('Error updating phone number:', error);
        }
        
        if (existingUser.email !== userData.email && userData.email) {
          console.log('updating email from', existingUser.email, 'to', userData.email);
          const { error } = await supabase.auth.admin.updateUserById(
            userId,
            { email: userData.email }
          );
          if (error) console.error('Error updating email:', error);
        }
      }

      // Create or update persona with non-sensitive data
      const personaData = {
        owner_id: userId,
        type: 'user',
        handle: userData.nickname?.toLowerCase().replace(/\s+/g, '_') || 
                `user_${userId.split('-')[0]}`,  // Take first segment of UUID
        avatar_url: userData.profileImage,
        metadata: {
          profile: {
            banner_image_url: userData.bannerImage,
            nickname: userData.nickname,
            bio: userData.bio,
            full_name: `${userData.firstName} ${userData.lastName}`.trim(),
            first_name: userData.firstName,
            last_name: userData.lastName,
            gender: userData.gender?.toLowerCase(),
            barzo_api_id: userData.id  // Added barzo_api_id to public profile
          }
        }
      };

      // Insert/update the persona
      const { data: persona, error: personaError } = await supabase
        .from('personas')
        .upsert({
          ...personaData
        }, {
          onConflict: 'handle',
          returning: true
        })
        .select();

      if (personaError) {
        console.error('Error creating persona:', personaError);
        continue;
      }

      if (!persona || !persona[0]) {
        console.error('No persona returned after upsert');
        continue;
      }

      // Create or update private persona data
      const privateData = {
        persona_id: persona[0].id,
        email: userData.email,
        phone: userData.phone,
        dob: userData.dob,
        address: null, // Add address if available in userData
        metadata: {
          identity: {
            external_id: userData.id
          },
          preferences: userData.preferences || {},
          settings: userData.settings || {}
        }
      };

      const { error: privateError } = await supabase
        .from('personas_private')
        .upsert(privateData, {
          onConflict: 'persona_id'
        });

      if (privateError) {
        console.error('Error creating private persona data:', privateError);
        continue;
      }

      console.log(`Successfully processed user: ${userData.firstName} ${userData.lastName} - ${userData.id}`);
    }

  } catch (error) {
    console.error('Error processing users:', error);
  }
}

// Update the function call to allow passing a filename
const filename = process.argv[2] || 'users.json';
loadUsers(filename).then(() => console.log('Done!'));
