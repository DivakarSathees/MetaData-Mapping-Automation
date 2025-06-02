const axios = require('axios');

exports.updateMetaData = async (questionData, token) => {
    const results = {
        updated: [],
        notUpdated: [],
    };

    let questionNumenr = 0;

    for (const question of questionData) {
        questionNumenr++;
        const { q_id, question_type, ...restData } = question; // Exclude q_id and question_type from payload
        let url = '';
        let method = '';

        switch (question_type) {
            case 'project_question':
                url = `https://api.examly.io/api/update/project_question/${q_id}`;
                method = 'put';
                break;
            case 'mcq_single_correct':
            case 'mcq_multiple_correct':
                url = `https://api.examly.io/api/update_mcq_question/${q_id}`;
                method = 'post';
                break;
            case 'programming':
                url = `https://api.examly.io/api/update_programming_question/${q_id}`;
                method = 'put';
                break;
            default:
                results.notUpdated.push({ q_id, reason: 'Unknown question_type' });
                continue;
        }

        try {
            await axios({
                method,
                url,
                data: restData,
                headers: {
                    "Authorization": token,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                }
            });

            console.log(`Updated Q.no ${questionNumenr} ${question_type} with ID: ${q_id}`);
            results.updated.push({q_id, question_type, questionNumenr});
            
        } catch (error) {
            console.error(`Failed to update Q.no ${questionNumenr} question ID ${q_id}:`, error.message);
            results.notUpdated.push({ q_id, reason: error.message, question_type, questionNumenr });
        }
    }

    return {
        success: results.notUpdated.length === 0,
        message: results.notUpdated.length === 0
            ? "All metadata updated successfully."
            : "Some questions were not updated.",
        results,

    };
};
