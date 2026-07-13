require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const supabase = require('./supabase');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and body parsers
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(__dirname));

// Mock SMS Gateway Endpoint
app.post('/api/sms', (req, res) => {
  const { to, message } = req.body;
  console.log(`\n--- EMERGENCY SMS OUTBOUND ---`);
  console.log(`To: ${Array.isArray(to) ? to.join(', ') : to}`);
  console.log(`Message:\n${message}`);
  console.log(`------------------------------\n`);
  
  res.status(200).json({
    success: true,
    message: 'SMS transmitted successfully via mock gateway.',
    timestamp: new Date().toISOString()
  });
});

// Database sync and storage endpoints
app.post('/api/users/sync', async (req, res) => {
  try {
    const { name, phone, guardians } = req.body;
    if (!phone || !name) {
      return res.status(400).json({ success: false, message: 'Name and phone are required.' });
    }

    let favs = [];

    try {
      // 1. Upsert user
      const { error: userErr } = await supabase
        .from('users')
        .upsert({ phone, name }, { onConflict: 'phone' });
      if (userErr) throw userErr;

      // 2. Sync guardians
      const { error: deleteErr } = await supabase
        .from('guardians')
        .delete()
        .eq('user_phone', phone);
      if (deleteErr) throw deleteErr;

      if (guardians && guardians.length > 0) {
        const guardiansToInsert = guardians.map(g => ({
          id: g.id,
          user_phone: phone,
          name: g.name,
          email: g.email,
          phone: g.phone
        }));
        const { error: insertErr } = await supabase
          .from('guardians')
          .insert(guardiansToInsert);
        if (insertErr) throw insertErr;
      }

      // 3. Fetch current favorites
      const { data: dbFavs, error: favsErr } = await supabase
        .from('favourites')
        .select('place_id')
        .eq('user_phone', phone);
      if (favsErr) throw favsErr;
      favs = dbFavs;

    } catch (dbErr) {
      console.warn('Supabase DB error (ignoring and falling back to local storage):', dbErr.message);
    }

    res.status(200).json({
      success: true,
      user: { name, phone },
      guardians: guardians || [],
      favourites: favs ? favs.map(f => f.place_id) : []
    });
  } catch (err) {
    console.error('Error syncing user:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/users/:phone', async (req, res) => {
  try {
    const { phone } = req.params;

    // Fetch user
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (userErr) throw userErr;
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Fetch guardians
    const { data: guardians, error: guardErr } = await supabase
      .from('guardians')
      .select('id, name, email, phone')
      .eq('user_phone', phone);

    if (guardErr) throw guardErr;

    // Fetch favourites
    const { data: favs, error: favsErr } = await supabase
      .from('favourites')
      .select('place_id')
      .eq('user_phone', phone);

    if (favsErr) throw favsErr;

    res.status(200).json({
      success: true,
      user: { name: user.name, phone: user.phone },
      guardians: guardians || [],
      favourites: favs ? favs.map(f => f.place_id) : []
    });
  } catch (err) {
    console.error('Error fetching user data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/users/:phone/guardians', async (req, res) => {
  try {
    const { phone } = req.params;
    const { guardians } = req.body;

    const { error: deleteErr } = await supabase
      .from('guardians')
      .delete()
      .eq('user_phone', phone);

    if (deleteErr) throw deleteErr;

    if (guardians && guardians.length > 0) {
      const guardiansToInsert = guardians.map(g => ({
        id: g.id,
        user_phone: phone,
        name: g.name,
        email: g.email,
        phone: g.phone
      }));
      const { error: insertErr } = await supabase
        .from('guardians')
        .insert(guardiansToInsert);

      if (insertErr) throw insertErr;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error updating guardians:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/users/:phone/favourites', async (req, res) => {
  try {
    const { phone } = req.params;
    const { placeId, action } = req.body;

    if (action === 'add') {
      const { error: err } = await supabase
        .from('favourites')
        .upsert({ user_phone: phone, place_id: placeId });

      if (err) throw err;
    } else if (action === 'remove') {
      const { error: err } = await supabase
        .from('favourites')
        .delete()
        .eq('user_phone', phone)
        .eq('place_id', placeId);

      if (err) throw err;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error updating favourites:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/emergency/alert', async (req, res) => {
  try {
    const { message, senderPhone, recipientEmails } = req.body;
    if (!senderPhone || !message) {
      return res.status(400).json({ success: false, message: 'senderPhone and message are required.' });
    }

    if (!recipientEmails || recipientEmails.length === 0) {
      console.log('No guardians provided with registered email addresses.');
      return res.status(200).json({ success: true, message: 'No registered guardian emails provided.' });
    }

    // Configure SMTP transport using process.env
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const mailOptions = {
      from: `"QuickFiix SOS" <${process.env.SMTP_USER}>`,
      to: recipientEmails.join(', '),
      subject: '🚨 EMERGENCY ALERT - QuickFiix Navigation Triggered',
      text: message,
      html: `<div style="font-family: Arial, sans-serif; padding: 20px; border: 2px solid #EF4444; border-radius: 8px; max-width: 600px; margin: auto;">
        <h2 style="color: #EF4444; margin-top: 0;">🚨 QuickFiix Emergency SOS</h2>
        <p style="font-size: 16px; line-height: 1.5; color: #1F2937;">
          ${message.replace(/\n/g, '<br>')}
        </p>
        <hr style="border: 0; border-top: 1px solid #E5E7EB; margin: 20px 0;">
        <p style="font-size: 12px; color: #6B7280; text-align: center;">
          This email was automatically generated and sent via QuickFiix Emergency Mechanic Finder.
        </p>
      </div>`
    };

    // Send mail
    const info = await transporter.sendMail(mailOptions);
    console.log('Emergency email sent successfully:', info.messageId);

    res.status(200).json({ success: true, messageId: info.messageId });
  } catch (err) {
    console.error('Error sending emergency email:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback routing for SPA details (redirect to index.html if needed)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`QuickFiix server is running at: http://localhost:${PORT}`);
  console.log(`Ready for local testing and demonstration.`);
  console.log(`==================================================\n`);
});
