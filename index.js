const express = require('express');
const cors = require('cors');


const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const admin = require("firebase-admin");

const stripe = require('stripe');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Initialize Stripe
const stripeClient = stripe(process.env.PAYMENT_GATEWAY_KEY);

// Middlewares
app.use(cors());
app.use(express.json());

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');

const serviceAccount = JSON.parse(decodedKey);

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.y56bxor.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db('parcelDB');
    const usersCollection = db.collection('users')
    const parcelCollection = db.collection('parcels');
    const paymentCollection = db.collection('payments');
    const trackingCollection = db.collection('trackings');
    const ridersCollection = db.collection('riders');


    // custom middlewares



admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



    const verifyFBToken = async(req, res, next) => {
     const authHeader = req.headers.authorization;
     if(!authHeader){
      return res.status(401).send({message: 'unauthoized access'})
     }

     const token = authHeader.split(' ')[1];
     if(!token){
       return res.status(401).send({message: 'unauthoized access'})
     }

    //  verify the token

    try{
      const decoded = await admin.auth().verifyIdToken(token);
      req.decoded = decoded;
    }

    catch (error){
       return res.status(403).send({message: 'forbidden'})
    }

      next();
    }


    // search user // make user admin // remove admin

    // helper: ensure req.decoded exists (verifyFBToken middleware should be applied before these)
const verifyAdmin = async (req, res, next) => {
  try {
    // require verifyFBToken before this middleware so req.decoded.email exists
    const requesterEmail = req.decoded?.email;
    if (!requesterEmail) return res.status(401).send({ message: "Unauthorized" });

    const adminUser = await usersCollection.findOne({ email: requesterEmail.toLowerCase() });
    if (!adminUser || adminUser.role !== "admin") {
      return res.status(403).send({ message: "Forbidden — admin only" });
    }
    next();
  } catch (err) {
    console.error("verifyAdmin error:", err);
    res.status(500).send({ message: "Server error" });
  }
};






    // SEARCH USER BY EMAIL (partial match allowed)

// GET /users/search?query=<text>
app.get("/users/search", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).send({ message: "Query is required" });

    const users = await usersCollection
      .find({
        $or: [
          { email: { $regex: query, $options: "i" } },
          { name: { $regex: query, $options: "i" } }
        ]
      })
      .project({ email: 1, name: 1, role: 1, created_at: 1 }) // select only needed fields
      .toArray();

    res.status(200).send({ success: true, data: users });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, message: "Server error", error });
  }
});

// Make user admin
app.patch("/users/make-admin/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const result = await usersCollection.updateOne(
      { email },
      { $set: { role: "admin" } }
    );
    res.send({ success: true, result });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, error });
  }
});

// Remove admin
app.patch("/users/remove-admin/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const result = await usersCollection.updateOne(
      { email },
      { $set: { role: "user" } }
    );
    res.send({ success: true, result });
  } catch (error) {
    console.error(error);
    res.status(500).send({ success: false, error });
  }
});


// users role

// ✓ Get user role by email
// Get user role by email (any authenticated user)
app.get("/users/role/:email", verifyFBToken, async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();

    // Only allow user to fetch their own role
    if (req.decoded.email.toLowerCase() !== email) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).send({ role: null });

    res.send({ role: user.role });
  } catch (err) {
    console.error("Error fetching user role:", err);
    res.status(500).send({ role: null });
  }
});










app.post('/users', async (req, res) => {
  const email = req.body.email.toLowerCase();
  const userExists = await usersCollection.findOne({ email });
  if (userExists) {
    return res.status(200).send({ message: 'User already exists', inserted: false });
  }

  const user = { ...req.body, email, role: "user", created_at: new Date() };
  const result = await usersCollection.insertOne(user);
  res.send(result);
});




    // ✅ Get all or user-specific parcels
    app.get("/parcels", verifyFBToken, async (req, res) => {
      try {
        const userEmail = req.query.email;
        const query = userEmail ? { created_by: userEmail } : {};
        const parcels = await parcelCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();
        res.status(200).json(parcels);
      } catch (error) {
        console.error("Error fetching parcels:", error);
        res.status(500).json({ message: "Error fetching parcels", error: error.message });
      }
    });

    // ✅ Create a new parcel
    app.post("/parcels", async (req, res) => {
      try {
        const newParcel = { ...req.body, createdAt: new Date() };
        const result = await parcelCollection.insertOne(newParcel);
        res.status(201).json({ success: true, id: result.insertedId });
      } catch (error) {
        console.error("Error inserting parcel:", error);
        res.status(500).json({ success: false, message: "Failed to create parcel" });
      }
    });

    // ✅ Get single parcel by ID
    app.get("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid parcel ID" });
        }

        const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
        if (!parcel) {
          return res.status(404).json({ message: "Parcel not found" });
        }

        res.status(200).json(parcel);
      } catch (error) {
        console.error("Error fetching parcel by ID:", error);
        res.status(500).json({ message: "Error fetching parcel by ID", error: error.message });
      }
    });

    // ✅ Delete parcel by ID
    app.delete("/parcels/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid parcel ID" });
        }

        const result = await parcelCollection.deleteOne({ _id: new ObjectId(id) });
        res.status(200).json(result);
      } catch (error) {
        console.error("Error deleting parcel:", error);
        res.status(500).json({ message: "Failed to delete parcel" });
      }
    });



    

app.post('/riders', async (req, res) => {
  const riderEmail = req.body.email.toLowerCase();
  const rider = { ...req.body, email: riderEmail, status: "pending", createdAt: new Date() };
  const result = await ridersCollection.insertOne(rider);
  res.send(result);
});


//parcel // by rider

// Get all pending delivery tasks for a rider
// GET: Fetch rider's pending deliveries

// GET /rider/tasks
app.get('/rider/tasks', verifyFBToken, async (req, res) => {
  const email = req.query.email?.toLowerCase();

  if (req.decoded.email !== email) {
    return res.status(403).send({ message: "Forbidden" });
  }

  const tasks = await parcelCollection.find({
    assigned_rider_email: email,
    delivery_status: { $in: ["rider_assigned", "in_transit"] },
  }).toArray();

  res.send(tasks);
});


/////////////////////////////////////////////


    // GET: Load all riders with status "pending"
app.get("/riders/pending", verifyFBToken, async (req, res) => {
  try {
    const pendingRiders = await ridersCollection
      .find({ status: "pending" })
      .sort({ createdAt: -1 })  // latest first
      .toArray();

    res.status(200).json({
      success: true,
      count: pendingRiders.length,
      data: pendingRiders,
    });
  } catch (error) {
    console.error("Error fetching pending riders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load pending riders",
      error: error.message,
    });
  }
});






app.patch("/riders/reject/:id", async (req, res) => {
  const id = req.params.id;
  const result = await ridersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "rejected" } }
  );

  res.send(result);
});


// GET: Load all active riders
app.get("/riders/active", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const activeRiders = await ridersCollection
      .find({ status: "active" })
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).json({
      success: true,
      count: activeRiders.length,
      data: activeRiders,
    });
  } catch (error) {
    console.error("Error fetching active riders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to load active riders",
      error: error.message,
    });
  }
});


    // update user role for accepting rider

   app.patch("/riders/approve/:id", async (req, res) => {
  try {
    const riderId = req.params.id;
    const rider = await ridersCollection.findOne({ _id: new ObjectId(riderId) });
    if (!rider) return res.status(404).send({ message: "Rider not found" });

    const riderEmail = rider.email.toLowerCase();

    // 1️⃣ Update rider status
    await ridersCollection.updateOne(
      { _id: new ObjectId(riderId) },
      { $set: { status: "active", approvedAt: new Date() } }
    );

    // 2️⃣ Update user role
    const userUpdate = await usersCollection.updateOne(
      { email: riderEmail },
      { $set: { role: "rider" } }
    );

    if (userUpdate.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: `User with email ${riderEmail} not found in users collection.`
      });
    }

    res.send({ success: true, message: "Rider approved & user role updated!" });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Server error", error });
  }
});




app.patch("/riders/deactivate/:id", async (req, res) => {
  const id = req.params.id;
  const result = await ridersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: "inactive" } }
  );

  res.send(result);
});





    
// GET /riders/by-region?region=Rajshahi
app.get(
  "/riders/by-region",
  verifyFBToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { region } = req.query;

      if (!region) {
        return res.status(400).send({ message: "Region is required" });
      }

      const riders = await ridersCollection
        .find({
          region: region,
          status: "active",
        })
        .project({
          name: 1,
          email: 1,
          region: 1,
          district: 1,
        })
        .toArray();

      res.send(riders);
    } catch (err) {
      console.error("Fetch riders error:", err);
      res.status(500).send({ message: "Failed to fetch riders" });
    }
  }
);



////

// or: const { ObjectId } = require('mongodb');

// PATCH /parcels/assign-rider/:id
app.patch('/parcels/:id/assign-rider', verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { riderName, riderEmail } = req.body;

    if (!riderName || !riderEmail) {
      return res.status(400).send({
        success: false,
        message: "Rider name and email are required"
      });
    }

    const result = await parcelCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          riderName,
          assigned_rider_email: riderEmail.toLowerCase(),
          delivery_status: "rider_assigned",
          assignedAt: new Date()
        }
      }
    );

    res.send({ success: true, result });
  } catch (err) {
    console.error("Assign rider error:", err);
    res.status(500).send({ success: false, message: "Failed to assign rider" });
  }
});



// PATCH /parcels/:id/delivery-status
app.patch("/parcels/:id/delivery-status", verifyFBToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // in_transit | delivered

    if (!["in_transit", "delivered"].includes(status)) {
      return res.status(400).send({ message: "Invalid delivery status" });
    }

    // Get parcel
    const parcel = await parcelCollection.findOne({ _id: new ObjectId(id) });
    if (!parcel) {
      return res.status(404).send({ message: "Parcel not found" });
    }

    // Only assigned rider can update
    if (parcel.assigned_rider_email !== req.decoded.email) {
      return res.status(403).send({ message: "Forbidden" });
    }

    const updateDoc = {
      delivery_status: status,
      updatedAt: new Date(),
    };

    if (status === "delivered") {
      updateDoc.deliveredAt = new Date();
    }

    const result = await parcelCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    );

    res.send({ success: true, result });
  } catch (error) {
    console.error("Delivery status error:", error);
    res.status(500).send({ message: "Failed to update delivery status" });
  }
});


///////// Deliverd parcels 

// GET /rider/completed
// Get completed (delivered) parcels for a rider
app.get('/rider/completed', verifyFBToken, async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).send({ message: "Email is required" });
    }

    // Security check – rider can only access own data
    if (req.decoded.email !== email) {
      return res.status(403).send({ message: "Forbidden access" });
    }

    const completedParcels = await parcelCollection
      .find({
        assigned_rider_email: email,
        delivery_status: "delivered",
      })
      .sort({ updatedAt: -1 })
      .toArray();

    res.send(completedParcels);
  } catch (error) {
    console.error("Error loading completed deliveries:", error);
    res.status(500).send({ message: "Failed to load completed deliveries" });
  }
});


// parcels tracking

app.post("/trackings", async (req, res) => {
  const {
    tracking_id,
    status,
    details,
    location,
    updated_by,
    rider,
  } = req.body;

  if (!tracking_id || !status) {
    return res.status(400).send({ message: "tracking_id and status required" });
  }

  const trackingDoc = {
    tracking_id,
    status,
    details,
    location,
    updated_by,
    rider, // ✅ STORED
    createdAt: new Date(),
  };

  const result = await db.collection("trackings").insertOne(trackingDoc);

  res.send({ success: true, insertedId: result.insertedId });
});

app.get("/my-parcels", verifyFBToken, async (req, res) => {
  const email = req.query.email;

  const parcels = await db.collection("parcels").find(
    { created_by: email },
    {
      projection: {
        title: 1,
        parcelType: 1,
        tracking_id: 1,
        receiverName: 1,
        delivery_status: 1,
        createdAt: 1,
      },
    }
  ).sort({ createdAt: -1 }).toArray();

  res.send(parcels);
});



app.get("/admin/dashboard-stats", async (req, res) => {
  try {
    const parcelsCollection = db.collection("parcels");

    const stats = await parcelsCollection.aggregate([
      {
        $facet: {
          totalParcels: [
            { $count: "count" }
          ],

          pendingParcels: [
            { $match: { delivery_status: "not_collected" } },
            { $count: "count" }
          ],

          inTransitParcels: [
            { $match: { delivery_status: "in_transit" } },
            { $count: "count" }
          ],

          deliveredParcels: [
            { $match: { delivery_status: "delivered" } },
            { $count: "count" }
          ],

          assignedRiders: [
            { $match: { assigned_rider_email: { $exists: true, $ne: null } } },
            {
              $group: {
                _id: "$assigned_rider_email",
                name: { $first: "$riderName" }
              }
            },
            { $count: "count" }
          ],
        },
      },
      {
        $project: {
          totalParcels: { $ifNull: [{ $arrayElemAt: ["$totalParcels.count", 0] }, 0] },
          pendingParcels: { $ifNull: [{ $arrayElemAt: ["$pendingParcels.count", 0] }, 0] },
          inTransitParcels: { $ifNull: [{ $arrayElemAt: ["$inTransitParcels.count", 0] }, 0] },
          deliveredParcels: { $ifNull: [{ $arrayElemAt: ["$deliveredParcels.count", 0] }, 0] },
          assignedRiders: { $ifNull: [{ $arrayElemAt: ["$assignedRiders.count", 0] }, 0] },
        }
      }
    ]).toArray();

    res.send(stats[0]);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load admin stats" });
  }
});





// rider earnings api



app.patch(
  "/parcels/:id/status",
  verifyFBToken,
  async (req, res) => {
    const { id } = req.params;
    const { delivery_status } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid parcel ID" });
    }

    const parcel = await parcelCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!parcel) {
      return res.status(404).send({ message: "Parcel not found" });
    }

    // 🔄 Update parcel status
    const updateDoc = {
      delivery_status,
      updatedAt: new Date(),
    };

    if (delivery_status === "delivered") {
      updateDoc.deliveredAt = new Date();
    }

    await parcelCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateDoc }
    );

    // 💰 Create earning ONLY when delivered
    if (delivery_status === "delivered") {
      const sameRegion =
        parcel.senderRegion === parcel.receiverRegion;

      const percentage = sameRegion ? 0.8 : 0.3;
      const earningAmount = Math.round(parcel.cost * percentage);

      await db.collection("riderEarnings").insertOne({
        riderEmail: parcel.assigned_rider_email,
        parcelId: parcel._id,
        amount: earningAmount,
        rule: sameRegion ? "same_region" : "different_region",
        status: "unpaid",
        createdAt: new Date(),
        paidAt: null,
      });
    }

    res.send({ success: true });
  }
);

// earnings get







app.get("/rider/earnings", verifyFBToken, async (req, res) => {
  const email = req.query.email;

  const parcels = await parcelCollection.find({
    assigned_rider_email: email,
    delivery_status: "delivered"
  }).toArray();

  console.log("Rider email:", email);
  console.log("Matched parcels:", parcels.length);

  let total = 0;

  const deliveries = parcels.map(parcel => {
    const sameDistrict =
      parcel.senderRegion === parcel.receiverRegion;

    const percentage = sameDistrict ? 0.8 : 0.3;
    const earning = Math.round(parcel.cost * percentage);

    total += earning;

    return {
      tracking_id: parcel.tracking_id,
      amount: earning,
      rule: sameDistrict ? "same_district" : "different_district"
    };
  });

  res.send({ total, deliveries });
});


app.post("/rider/cashout", verifyFBToken, async (req, res) => {
  const email = req.decoded.email.toLowerCase();
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).send({ message: "Invalid cash out amount" });
  }

  const unpaidEarnings = await db
    .collection("riderEarnings")
    .find({ riderEmail: email, status: "unpaid" })
    .sort({ createdAt: 1 }) // FIFO payout
    .toArray();

  if (unpaidEarnings.length === 0) {
    return res.status(400).send({ message: "No earnings to cash out" });
  }

  const totalUnpaid = unpaidEarnings.reduce(
    (sum, e) => sum + e.amount,
    0
  );

  if (amount > totalUnpaid) {
    return res.status(400).send({
      message: "Cash out amount exceeds unpaid balance",
    });
  }

  let remaining = amount;
  const paidIds = [];

  for (const earning of unpaidEarnings) {
    if (remaining <= 0) break;

    remaining -= earning.amount;
    paidIds.push(earning._id);
  }

  await db.collection("riderEarnings").updateMany(
    { _id: { $in: paidIds } },
    {
      $set: {
        status: "paid",
        paidAt: new Date(),
      },
    }
  );

  res.send({
    success: true,
    paidAmount: amount,
    remainingUnpaid: totalUnpaid - amount,
  });
});


// app.post("/rider/cashout", verifyFBToken, async (req, res) => {
//   const email = req.decoded.email;
//   const { amount } = req.body;

//   if (!amount || amount <= 0) {
//     return res.status(400).send({ message: "Invalid cash out amount" });
//   }

//   const unpaidEarnings = await db
//     .collection("riderEarnings")
//     .find({ riderEmail: email, status: "unpaid" })
//     .sort({ createdAt: 1 }) // oldest first
//     .toArray();

//   const totalUnpaid = unpaidEarnings.reduce(
//     (sum, e) => sum + e.amount,
//     0
//   );

//   if (amount > totalUnpaid) {
//     return res
//       .status(400)
//       .send({ message: "Amount exceeds unpaid balance" });
//   }

//   let remainingToPay = amount;
//   const paidIds = [];

//   for (const earning of unpaidEarnings) {
//     if (remainingToPay <= 0) break;

//     paidIds.push(earning._id);
//     remainingToPay -= earning.amount;
//   }

//   await db.collection("riderEarnings").updateMany(
//     { _id: { $in: paidIds } },
//     {
//       $set: {
//         status: "paid",
//         paidAt: new Date(),
//       },
//     }
//   );

//   res.send({
//     success: true,
//     paidAmount: amount,
//     remainingBalance: totalUnpaid - amount,
//   });
// });






//   const email = req.decoded.email.toLowerCase();

//   // Get delivered parcels for this rider
//   const parcels = await parcelCollection.find({
//     assigned_rider_email: email,
//     delivery_status: "delivered",
//     cashedOut: { $ne: true } // not cashed out yet
//   }).toArray();

//   if (parcels.length === 0) {
//     return res.status(400).send({ message: "No earnings to cash out" });
//   }

//   let totalAmount = 0;

//   parcels.forEach(parcel => {
//     const sameRegion = parcel.senderRegion === parcel.receiverRegion;
//     const percentage = sameRegion ? 0.8 : 0.3;
//     totalAmount += Math.round(parcel.cost * percentage);
//   });

//   // Mark parcels as cashed out
//   const parcelIds = parcels.map(p => p._id);

//   await parcelCollection.updateMany(
//     { _id: { $in: parcelIds } },
//     {
//       $set: {
//         cashedOut: true,
//         cashedOutAt: new Date(),
//       },
//     }
//   );

//   res.send({
//     success: true,
//     paidAmount: totalAmount,
//   });
// });










    // ✅ Get payment history (user or all for admin)
    app.get('/payments', verifyFBToken, async (req, res) => {

      
      try {
        const userEmail = req.query.email;
        console.log('decoded', req.decoded)
        if(req.decoded.email !== userEmail){
          return res.status(403).send({message: 'forbidden access'})
        }


        const query = userEmail ? { email: userEmail } : {};
        const payments = await paymentCollection
          .find(query)
          .sort({ createdAt: -1 }) // latest first
          .toArray();
        res.status(200).json(payments);
      } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).json({ message: 'Failed to get payments' });
      }
    });

    // ✅ Save payment + mark parcel as paid
 app.post('/payments', async (req, res) => {
  try {
    const payment = req.body;

    // Add createdAt timestamp
    payment.createdAt = new Date();

    // Save payment record in DB
    const result = await paymentCollection.insertOne(payment);

    // If parcelId is provided, update parcel as paid
    const parcelId = payment.parcelId;

    if (parcelId && ObjectId.isValid(parcelId)) {
      await parcelCollection.updateOne(
        { _id: new ObjectId(parcelId) },
        {
          $set: {
            payment_status: "paid",
            transactionId: payment.transactionId,
            updatedAt: new Date(),
          },
        }
      );
    }

    res.status(201).json({
      success: true,
      insertedId: result.insertedId,
    });

  } catch (error) {
    console.error("Error saving payment:", error);
    res.status(500).json({ message: "Failed to record payment" });
  }
});


    // ✅ Stripe payment intent creation
app.post('/create-payment-intent', async (req, res) => {
  const { amountInCents } = req.body;

  if (!amountInCents || isNaN(amountInCents)) {
    return res.status(400).send({ message: "Amount is required" });
  }

  try {
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      payment_method_types: ['card'],
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error("Stripe error:", error);
    res.status(500).send({ message: error.message });
  }
});



    // ✅ MongoDB connection test
    // await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

// ✅ Root route
app.get("/", (req, res) => {
  res.send("🚀 Parcel server is running successfully!");
});

// ✅ Start server
app.listen(port, () => {
  console.log(`✅ Server is running on port ${port}`);
});
