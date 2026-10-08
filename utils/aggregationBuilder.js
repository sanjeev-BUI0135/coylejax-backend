const mongoose = require("mongoose");

const buildAggregationPipeline = ({
  query,
  search = "",
  sort = "-createdAt",
  page = 1,
  limit = 10,
  isAll = false,
  includeProject = true,
  includeCustomer = false,
  includeEstimate = false,
  company_name,
  customer,
  division_type,
  project_id,
  status,
  statusField = "status",
  estimate_number,
  project_name,
  customer_name,
  type,
  total_amount,
  created_date,
  user,
  requiresApproval,
  approvalThreshold
}) => {
  const parsedLimit = parseInt(limit);
  const skip = isAll ? 0 : (page - 1) * parsedLimit;

  // SORT
  let sortObj = {};
  if (typeof sort === "string") {
    const field = sort.startsWith("-") ? sort.slice(1) : sort;
    const order = sort.startsWith("-") ? -1 : 1;
    sortObj[field] = order;
    
    // MongoDB Pagination Bug Fix: Always add _id as a secondary sort to ensure stable order
    if (field !== "_id") {
      sortObj["_id"] = -1;
    }
  } else {
    sortObj = sort || {};
    if (!sortObj["_id"]) {
      sortObj["_id"] = -1;
    }
  }

  // BASE
  const pipeline = [{ $match: query }];

  // PROJECT JOIN
  if (includeProject) {
    pipeline.push(
      {
        $addFields: {
          projectObjId: {
            $cond: [
              { $eq: [{ $type: "$project_id" }, "string"] },
              {
                $cond: [
                  { $ne: ["$project_id", ""] },
                  { $toObjectId: "$project_id" },
                  null
                ]
              },
              "$project_id"
            ]
          },
          id: "$_id"
        }
      },
      {
        $lookup: {
          from: "projects",
          localField: "projectObjId",
          foreignField: "_id",
          as: "project"
        }
      },
      {
        $unwind: {
          path: "$project",
          preserveNullAndEmptyArrays: true
        }
      }
    );
  }

  // CUSTOMER JOIN
  if (includeCustomer) {
    pipeline.push(
      {
        $lookup: {
          from: "customers",
          localField: "project.customer_ids",
          foreignField: "_id",
          as: "customer_data"
        }
      },
      {
        $addFields: {
          "project.customer_ids": "$customer_data"
        }
      },
      {
        $project: {
          customer_data: 0
        }
      }
    );
  }

  // ESTIMATE JOIN
  if (includeEstimate) {
    pipeline.push(
      {
        $addFields: {
          estimateObjId: {
            $cond: [
              { $eq: [{ $type: "$estimate_id" }, "string"] },
              {
                $cond: [
                  { $ne: ["$estimate_id", ""] },
                  { $toObjectId: "$estimate_id" },
                  null
                ]
              },
              "$estimate_id"
            ]
          }
        }
      },
      {
        $lookup: {
          from: "estimates",
          localField: "estimateObjId",
          foreignField: "_id",
          as: "estimate_data"
        }
      },
      {
        $unwind: {
          path: "$estimate_data",
          preserveNullAndEmptyArrays: true
        }
      }
    );
  }

  // GLOBAL SEARCH
  if (search?.trim()) {
    pipeline.push({
      $match: {
        $or: [

          // ESTIMATE NUMBER
          {
            estimate_number: {
              $regex: search,
              $options: "i"
            }
          },

          // INVOICE NUMBER
          {
            invoice_number: {
              $regex: search,
              $options: "i"
            }
          },

          // CUSTOMER PO
          {
            customer_po_number: {
              $regex: search,
              $options: "i"
            }
          },

          // PROJECT NAME
          {
            "project.project_name": {
              $regex: search,
              $options: "i"
            }
          },

          // PROJECT NUMBER
          {
            "project.project_number": {
              $regex: search,
              $options: "i"
            }
          },

          // COMPANY NAME
          {
            "project.customer_ids.company_name": {
              $regex: search,
              $options: "i"
            }
          },

          // CUSTOMER NAME
          {
            "project.customer_ids.contact_name": {
              $regex: search,
              $options: "i"
            }
          },

          {
            [includeEstimate
              ? "estimate_data.quick_customer.company_name"
              : "quick_customer.company_name"]: {
              $regex: search,
              $options: "i"
            }
          },

          // QUICK CUSTOMER NAME
          {
            [includeEstimate
              ? "estimate_data.quick_customer.customer_name"
              : "quick_customer.customer_name"]: {
              $regex: search,
              $options: "i"
            }
          },

          // QUICK PROJECT NAME
          {
            [includeEstimate
              ? "estimate_data.quick_customer.project_name"
              : "quick_customer.project_name"]: {
              $regex: search,
              $options: "i"
            }
          },
          // ORDER STATUS
          {
            order_status: {
              $regex: search,
              $options: "i"
            }
          },
        ]
      }
    });
  }

  // ESTIMATE NUMBER
  if (estimate_number?.trim()) {
    pipeline.push({
      $match: {
        estimate_number: {
          $regex: estimate_number,
          $options: "i"
        }
      }
    });
  }

  // PROJECT NAME
  if (project_name?.trim()) {
    pipeline.push({
      $match: {
        $or: [
          {
            "project.project_name": {
              $regex: project_name,
              $options: "i"
            }
          },
          {
            [includeEstimate
              ? "estimate_data.quick_customer.project_name"
              : "quick_customer.project_name"]: {
              $regex: project_name,
              $options: "i"
            }
          }
        ]
      }
    });
  }

  // CUSTOMER NAME
  if (customer_name?.trim()) {
    pipeline.push({
      $match: {
        $or: [
          {
            "project.customer_ids.contact_name": {
              $regex: customer_name,
              $options: "i"
            }
          },
          {
            [includeEstimate
              ? "estimate_data.quick_customer.customer_name"
              : "quick_customer.customer_name"]: {
              $regex: customer_name,
              $options: "i"
            }
          }
        ]
      }
    });
  }

  // DIVISION TYPE
  if (type?.trim()) {
    pipeline.push({
      $match: {
        $or: [
          {
            "project.project_type": type
          },
          {
            "quick_customer.division_type": type
          }
        ]
      }
    });
  }

  // TOTAL AMOUNT
  if (total_amount?.trim()) {
    pipeline.push({
      $match: {
        total_amount: Number(total_amount)
      }
    });
  }

  if (created_date?.trim()) {

    const startDate = new Date(created_date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(created_date);
    endDate.setHours(23, 59, 59, 999);

    pipeline.push({
      $match: {
        $or: [
          {
            created_date: {
              $gte: startDate,
              $lte: endDate
            }
          },
          {
            createdAt: {
              $gte: startDate,
              $lte: endDate
            }
          }
        ]
      }
    });
  }

  if (company_name?.trim()) {
    pipeline.push({
      $match: {
        $or: [
          {
            [includeEstimate
              ? "estimate_data.quick_customer.company_name"
              : "quick_customer.company_name"]: {
              $regex: company_name,
              $options: "i"
            }
          },
          {
            "project.customer_ids.company_name": {
              $regex: company_name,
              $options: "i"
            }
          }
        ]
      }
    });
  }

  if (project_id?.trim()) {

    const projectObjectId =
      mongoose.Types.ObjectId.isValid(project_id)
        ? new mongoose.Types.ObjectId(project_id)
        : null;

    pipeline.push({
      $match: {
        $or: [
          { project_id: project_id },
          { project_id: projectObjectId },
          { "project._id": projectObjectId }
        ]
      }
    });
  }

  // STATUS FILTER
  if (status?.trim()) {
    pipeline.push({
      $match: {
        [statusField]: {
           $regex: status,
          $options: "i"
        }
      }
    });
  }

  // CUSTOMER FILTER
  if (customer?.trim()) {
    const customerObjectId =
      mongoose.Types.ObjectId.isValid(customer)
        ? new mongoose.Types.ObjectId(customer)
        : null;

    pipeline.push({
      $match: {
        $or: [
          { "quick_customer._id": customerObjectId },
          { "quick_customer.id": customer },

          // Project customers
          {
            "project.customer_ids": {
              $elemMatch: {
                $or: [
                  { _id: customerObjectId },
                  { id: customer }
                ]
              }
            }
          }
        ]
      }
    });
  }
  // DIVISION FILTER
  if (division_type?.trim()) {
    pipeline.push({
      $match: {
        $or: [
          {
            "quick_customer.division_type": division_type
          },
          {
            "project.project_type": division_type
          }
        ]
      }
    });
  }

  // NESTED DIVISION SCOPE (For User Permissions)
  if (user && !user.allDataVisible) {
    if (user.nestedDivisionScope && user.nestedDivisionScope.length > 0) {
      pipeline.push({ $match: { $or: user.nestedDivisionScope } });
    } else if (user.role_type !== 'admin' && user.role_type !== 'superadmin') {
      pipeline.push({
        $match: {
          $or: [
            { created_by_user: user._id },
            { created_by_user: user._id.toString() }
          ]
        }
      });
    }
  }

  // APPROVAL FILTER
  if (requiresApproval && requiresApproval !== "all") {
    pipeline.push({
      $addFields: {
        materialOrderCost: {
          $cond: [
            { $gt: [{ $ifNull: ["$estimate_data.total_amount", 0] }, 0] },
            "$estimate_data.total_amount",
            {
              $cond: [
                { $gt: [{ $ifNull: ["$estimate_data.total_cost", 0] }, 0] },
                "$estimate_data.total_cost",
                {
                  $cond: [
                    { $gt: [{ $ifNull: ["$total_cost", 0] }, 0] },
                    "$total_cost",
                    {
                      $sum: {
                        $map: {
                          input: "$line_items",
                          as: "item",
                          in: {
                            $multiply: [
                              { $ifNull: ["$$item.quantity_ordered", 0] },
                              { $ifNull: ["$$item.unit_price", 0] }
                            ]
                          }
                        }
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    });

    const threshold = Number(approvalThreshold) || 15000;
    if (requiresApproval === "yes") {
      pipeline.push({
        $match: {
          materialOrderCost: { $gt: threshold }
        }
      });
    } else if (requiresApproval === "no") {
      pipeline.push({
        $match: {
          materialOrderCost: { $lte: threshold }
        }
      });
    }
  }

  // SORT + PAGINATION
  pipeline.push({ $sort: sortObj });

  if (!isAll) {
    pipeline.push({ $skip: skip }, { $limit: parsedLimit });
  }

  // COUNT PIPELINE
  const countPipeline = [...pipeline];

  // remove skip & limit safely
  if (!isAll) {
    countPipeline.pop(); // limit
    countPipeline.pop(); // skip
  }

  countPipeline.push({ $count: "total" });

  return { pipeline, countPipeline };
};

module.exports = buildAggregationPipeline;