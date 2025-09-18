const express = require('express');
const supabase = require('../utils/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get driver earnings stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const driverId = req.user.id;
    const { startDate, endDate } = req.query;

    if (req.user.user_type !== 'driver') {
      return res.status(403).json({ error: 'Only drivers can view stats' });
    }

    // Build query with optional date filtering
    let query = supabase
      .from('rides')
      .select('*')
      .eq('driver_id', driverId)
      .eq('status', 'completed');

    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    const { data: rides, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate stats
    const totalRides = rides.length;
    const totalGrossEarnings = rides.reduce((sum, ride) => sum + (ride.final_fare || ride.estimated_fare), 0);
    const platformFee = Math.round(totalGrossEarnings * 0.20); // 20% commission
    const totalNetEarnings = totalGrossEarnings - platformFee;
    
    // Group by time periods
    const today = new Date();
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const todayRides = rides.filter(ride => 
      new Date(ride.created_at).toDateString() === today.toDateString()
    );
    const weekRides = rides.filter(ride => 
      new Date(ride.created_at) >= thisWeek
    );
    const monthRides = rides.filter(ride => 
      new Date(ride.created_at) >= thisMonth
    );

    const todayEarnings = todayRides.reduce((sum, ride) => 
      sum + Math.round((ride.final_fare || ride.estimated_fare) * 0.8), 0
    );
    const weekEarnings = weekRides.reduce((sum, ride) => 
      sum + Math.round((ride.final_fare || ride.estimated_fare) * 0.8), 0
    );
    const monthEarnings = monthRides.reduce((sum, ride) => 
      sum + Math.round((ride.final_fare || ride.estimated_fare) * 0.8), 0
    );

    res.json({
      totalStats: {
        totalRides,
        totalGrossEarnings, 
        platformFee,        
        totalNetEarnings,   
        availableToWithdraw: totalNetEarnings 
      },
      periodStats: {
        today: {
          rides: todayRides.length,
          earnings: todayEarnings
        },
        week: {
          rides: weekRides.length,
          earnings: weekEarnings
        },
        month: {
          rides: monthRides.length,
          earnings: monthEarnings
        }
      },
      recentRides: rides.slice(0, 10) 
    });

  } catch (error) {
    console.error('Driver stats error:', error);
    res.status(500).json({ error: 'Failed to fetch driver stats' });
  }
});

module.exports = router;
