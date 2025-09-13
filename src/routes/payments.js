const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const supabase = require('../utils/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Create payment intent
router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { rideId } = req.body;

    // Get ride details
    const { data: ride, error } = await supabase
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .single();

    if (error || !ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Check if user is the rider
    if (ride.rider_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(ride.estimated_fare), // Amount in cents
      currency: 'usd',
      metadata: {
        rideId: rideId,
        riderId: req.user.id
      }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      amount: paymentIntent.amount
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Webhook to handle successful payments
router.post('/webhook', express.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      handleSuccessfulPayment(paymentIntent);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({received: true});
});

async function handleSuccessfulPayment(paymentIntent) {
  try {
    const { rideId } = paymentIntent.metadata;
    
    // Update ride payment status
    await supabase
      .from('rides')
      .update({
        payment_status: 'paid',
        payment_intent_id: paymentIntent.id,
        final_fare: paymentIntent.amount,
        paid_at: new Date().toISOString()
      })
      .eq('id', rideId);
    
    console.log(`Payment successful for ride ${rideId}`);
  } catch (error) {
    console.error('Error handling successful payment:', error);
  }
}

module.exports = router;
