// Netlify Function: Contact Form Handler
// File: netlify/functions/contact.js

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': 'https://showroommarket.com',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    // Parse request body
    const data = JSON.parse(event.body);
    
    console.log('Contact form submission received');

    // ========================================
    // SECURITY CHECKS
    // ========================================

    // 1. CHECK HONEYPOT FIELD
    if (data.website && data.website !== '') {
      console.log('Bot detected: Honeypot field filled');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false,
          message: 'Invalid submission detected' 
        })
      };
    }

    // 2. VERIFY reCAPTCHA
    if (!data.recaptcha_token) {
      console.log('Missing reCAPTCHA token');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false,
          message: 'Missing security token' 
        })
      };
    }

    const recaptchaResponse = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${data.recaptcha_token}`
    });

    const recaptchaData = await recaptchaResponse.json();
    
    if (!recaptchaData.success) {
      console.log('reCAPTCHA verification failed:', recaptchaData);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false,
          message: 'Security verification failed. Please try again.' 
        })
      };
    }

    // Check reCAPTCHA score (v3 returns a score 0.0-1.0)
    if (recaptchaData.score && recaptchaData.score < 0.5) {
      console.log('reCAPTCHA score too low:', recaptchaData.score);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false,
          message: 'Suspicious activity detected. Please try again later.' 
        })
      };
    }

    // 3. CHECK SUBMISSION SPEED
    if (data.form_start_time) {
      const startTime = parseInt(data.form_start_time);
      const elapsed = Date.now() - startTime;
      
      // Must take at least 3 seconds
      if (elapsed < 3000) {
        console.log('Submission too fast:', elapsed, 'ms');
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            success: false,
            message: 'Please take your time filling out the form.' 
          })
        };
      }
    }

    // 4. VALIDATE REQUIRED FIELDS
    if (!data.name || !data.email || !data.subject || !data.message) {
      console.log('Missing required fields');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false,
          message: 'Please fill in all required fields.' 
        })
      };
    }

    // 5. VALIDATE EMAIL FORMAT
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      console.log('Invalid email format');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false,
          message: 'Please enter a valid email address.' 
        })
      };
    }

    // 6. CHECK PRIVACY CONSENT
    if (data.privacy_consent !== 'on') {
      console.log('Privacy consent not given');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false,
          message: 'Please agree to the Privacy Policy to continue.' 
        })
      };
    }

    // ========================================
    // SANITIZE INPUT
    // ========================================
    
    const sanitizedData = {
      name: data.name.substring(0, 100).trim(),
      email: data.email.substring(0, 100).trim().toLowerCase(),
      phone: data.phone ? data.phone.substring(0, 20).trim() : '',
      inquiry_type: data.inquiry_type || 'general',
      subject: data.subject.substring(0, 200).trim(),
      message: data.message.substring(0, 2000).trim(),
      privacy_consent: true,
      timestamp: new Date().toISOString(),
      ip: event.headers['client-ip'] || event.headers['x-forwarded-for'] || 'unknown',
      user_agent: event.headers['user-agent'] || 'unknown',
      recaptcha_score: recaptchaData.score || 'N/A'
    };

    console.log('Sanitized data:', {
      name: sanitizedData.name,
      email: sanitizedData.email,
      inquiry_type: sanitizedData.inquiry_type,
      timestamp: sanitizedData.timestamp
    });

    // ========================================
    // SEND EMAIL (Choose your email service)
    // ========================================

    // OPTION 1: SendGrid (Recommended)
    if (process.env.SENDGRID_API_KEY) {
      await sendViaSendGrid(sanitizedData);
    }
    
    // OPTION 2: Mailgun
    // else if (process.env.MAILGUN_API_KEY) {
    //   await sendViaMailgun(sanitizedData);
    // }
    
    // OPTION 3: AWS SES
    // else if (process.env.AWS_ACCESS_KEY_ID) {
    //   await sendViaSES(sanitizedData);
    // }
    
    // For now, just log (remove this in production)
    else {
      console.log('No email service configured. Message:', sanitizedData);
    }

    // ========================================
    // STORE IN DATABASE (Optional)
    // ========================================
    
    // If you want to store submissions in a database:
    // await storeInDatabase(sanitizedData);

    // ========================================
    // SUCCESS RESPONSE
    // ========================================
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Message received! We\'ll respond within 24 hours.'
      })
    };

  } catch (error) {
    console.error('Contact form error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: 'An error occurred. Please try again or email us directly at hello@showroommarket.com'
      })
    };
  }
};

// ========================================
// EMAIL SENDING FUNCTIONS
// ========================================

async function sendViaSendGrid(data) {
  const fetch = require('node-fetch');
  
  const emailData = {
    personalizations: [{
      to: [{ email: 'hello@showroommarket.com' }],
      subject: `[Contact Form] ${data.subject}`
    }],
    from: {
      email: 'noreply@showroommarket.com',
      name: 'SHOWROOM MARKET'
    },
    reply_to: {
      email: data.email,
      name: data.name
    },
    content: [{
      type: 'text/html',
      value: `
        <h2>New Contact Form Submission</h2>
        <p><strong>From:</strong> ${data.name} (${data.email})</p>
        <p><strong>Phone:</strong> ${data.phone || 'Not provided'}</p>
        <p><strong>Inquiry Type:</strong> ${data.inquiry_type}</p>
        <p><strong>Subject:</strong> ${data.subject}</p>
        <p><strong>Message:</strong></p>
        <p>${data.message.replace(/\n/g, '<br>')}</p>
        <hr>
        <p style="color: #666; font-size: 12px;">
          <strong>Timestamp:</strong> ${data.timestamp}<br>
          <strong>IP:</strong> ${data.ip}<br>
          <strong>reCAPTCHA Score:</strong> ${data.recaptcha_score}<br>
          <strong>User Agent:</strong> ${data.user_agent}
        </p>
      `
    }]
  };

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(emailData)
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('SendGrid error:', error);
    throw new Error('Failed to send email via SendGrid');
  }

  console.log('Email sent successfully via SendGrid');
}

async function sendViaMailgun(data) {
  const fetch = require('node-fetch');
  const FormData = require('form-data');
  
  const form = new FormData();
  form.append('from', 'SHOWROOM MARKET <noreply@showroommarket.com>');
  form.append('to', 'hello@showroommarket.com');
  form.append('subject', `[Contact Form] ${data.subject}`);
  form.append('html', `
    <h2>New Contact Form Submission</h2>
    <p><strong>From:</strong> ${data.name} (${data.email})</p>
    <p><strong>Phone:</strong> ${data.phone || 'Not provided'}</p>
    <p><strong>Inquiry Type:</strong> ${data.inquiry_type}</p>
    <p><strong>Subject:</strong> ${data.subject}</p>
    <p><strong>Message:</strong></p>
    <p>${data.message.replace(/\n/g, '<br>')}</p>
  `);
  form.append('h:Reply-To', data.email);

  const response = await fetch(
    `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64')}`
      },
      body: form
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Mailgun error:', error);
    throw new Error('Failed to send email via Mailgun');
  }

  console.log('Email sent successfully via Mailgun');
}

// ========================================
// INSTALLATION INSTRUCTIONS
// ========================================

/*
1. SAVE THIS FILE:
   Location: netlify/functions/contact.js

2. ADD ENVIRONMENT VARIABLES IN NETLIFY:
   - RECAPTCHA_SECRET_KEY (required)
   - SENDGRID_API_KEY (optional, for sending emails)
   - MAILGUN_API_KEY (optional, alternative to SendGrid)
   - MAILGUN_DOMAIN (optional, if using Mailgun)

3. INSTALL DEPENDENCIES:
   Add to package.json:
   {
     "dependencies": {
       "node-fetch": "^2.6.1"
     }
   }

4. TEST THE FUNCTION:
   - Deploy to Netlify
   - Submit contact form
   - Check Netlify Functions logs
   - Verify email received

5. CONFIGURE EMAIL SERVICE:
   
   SENDGRID (Recommended):
   - Sign up at sendgrid.com (free tier: 100 emails/day)
   - Get API key
   - Add to Netlify env: SENDGRID_API_KEY
   - Verify sender email
   
   MAILGUN (Alternative):
   - Sign up at mailgun.com (free tier: 5,000 emails/month)
   - Get API key and domain
   - Add to Netlify env: MAILGUN_API_KEY, MAILGUN_DOMAIN

6. MONITORING:
   - Check Netlify Functions logs for errors
   - Set up email notifications for failures
   - Monitor reCAPTCHA scores

7. RATE LIMITING (Optional):
   - Add rate limiting per IP address
   - See SECURITY_STRATEGY.md for implementation
*/
