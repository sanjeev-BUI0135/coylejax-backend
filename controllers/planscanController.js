const axios = require("axios"); 

const GLACIERAI_API_BASE = 
    process.env.GLACIERAI_API_BASE || "https://ai.4glaciers.com/api/v1"; 


const getApiKey = (req) => { 
    return req.headers["x-api-key"] 
}; 

// Get Projects 
exports.getProjects = async (req, res) => { 
    
    
    try { 
        const apiKey = getApiKey(req); 
        const response = await axios.get( 
            `${GLACIERAI_API_BASE}/projects`, 
            {
                headers: { 
                    "x-api-key": apiKey, 
                }, 
            } 
        ); 

        res.status(200).json({ 
            success: true, 
            data: response.data, 
        }); 
    } catch (error) {  
        console.error("GlacierAI Projects Error:", error.response?.data || error.message); 

        res.status(error.response?.status || 500).json({ 
            success: false, 
            message: error.response?.data || error.message, 
        }); 
    }
};

// Get Project Items
exports.getProjectItems = async (req, res) => { 
    try {
        const { projectId } = req.params; 
        const apiKey = getApiKey(req); 

        const response = await axios.post( 
            `${GLACIERAI_API_BASE}/projects/export`, 
            {
                project_id: projectId, 
            },
            {
                headers: { 
                    "Content-Type": "application/json", 
                    "x-api-key": apiKey, 
                },
            }
        );

        res.status(200).json({ 
            success: true, 
            data: response.data, 
        });
    } catch (error) {
        console.error( 
            "GlacierAI Items Error:", 
            error.response?.data || error.message 
        );

        res.status(error.response?.status || 500).json({ 
            success: false,
            message: error.response?.data || error.message, 
        });
    }
};

// Get Project Detail
exports.getProjectById = async (req, res) => { 
    try { 
        const { projectId } = req.params; 
        const apiKey = getApiKey(req); 

        const response = await axios.post( 
            `${GLACIERAI_API_BASE}/projects/export`,   
            {
                project_id: projectId, 
            },
            {
                headers: { 
                    "Content-Type": "application/json", 
                    "x-api-key": apiKey, 
                },
            }
        );

        res.status(200).json({ 
            success: true, 
            data: response.data, 
        });
    } catch (error) {
        console.error("GlacierAI Project Detail Error:", error.response?.data || error.message); 

        res.status(error.response?.status || 500).json({ 
            success: false, 
            message: error.response?.data || error.message, 
        });
    }
};