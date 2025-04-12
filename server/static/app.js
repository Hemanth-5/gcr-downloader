// Google Classroom Materials Downloader
document.addEventListener('DOMContentLoaded', function() {
    // Use relative URLs since frontend and backend are now served from the same origin
    const backendUrl = '';
    const loginBtn = document.getElementById('login-btn');
    const authContainer = document.getElementById('auth-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    const courseListElement = document.getElementById('course-list');
    const loadingElement = document.getElementById('loading');
    const downloadLoadingElement = document.getElementById('download-loading');
    const userInfoElement = document.getElementById('user-info');
    const statusMessageElement = document.getElementById('status-message');

    // Check if user is already logged in
    checkAuthStatus();

    // Event listener for login button
    loginBtn.addEventListener('click', function() {
        window.location.href = `${backendUrl}/auth/google`;
    });

    // Function to check authentication status
    async function checkAuthStatus() {
        try {
            const response = await fetch(`${backendUrl}/courses`, {
                credentials: 'include'
            });
            
            if (response.ok) {
                // User is authenticated, show dashboard
                authContainer.classList.add('hidden');
                dashboardContainer.classList.remove('hidden');
                loadCourses();
                loadUserInfo();
            } else {
                // User not authenticated, show login button
                authContainer.classList.remove('hidden');
                dashboardContainer.classList.add('hidden');
            }
        } catch (error) {
            console.error('Error checking auth status:', error);
            showStatusMessage('Error connecting to server. Please try again.', 'error');
        }
    }

    // Function to load user info
    async function loadUserInfo() {
        try {
            const response = await fetch(`${backendUrl}/user-info`, {
                credentials: 'include'
            });
            
            if (response.ok) {
                const userData = await response.json();
                userInfoElement.innerHTML = `
                    <div class="user-profile">
                        <img src="${userData.picture}" alt="Profile" class="user-avatar">
                        <div>
                            <div class="user-name">${userData.name}</div>
                            <div class="user-email">${userData.email}</div>
                        </div>
                    </div>
                    <button id="logout-btn" class="logout-btn">
                        <svg class="logout-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                            <path fill="#5f6368" d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
                        </svg>
                        Logout
                    </button>
                `;
                
                // Add event listener to the logout button
                document.getElementById('logout-btn').addEventListener('click', logout);
            }
        } catch (error) {
            console.error('Error loading user info:', error);
        }
    }
    
    // Function to logout
    function logout() {
        window.location.href = `${backendUrl}/logout`;
    }

    // Function to load user's courses
    async function loadCourses() {
        try {
            loadingElement.style.display = 'block';
            courseListElement.innerHTML = '';
            
            const response = await fetch(`${backendUrl}/courses`, {
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Failed to load courses');
            }
            
            const courses = await response.json();
            
            if (courses.length === 0) {
                courseListElement.innerHTML = '<p>No courses found. You might need to join some Google Classroom courses first.</p>';
            } else {
                renderCourses(courses);
            }
        } catch (error) {
            console.error('Error loading courses:', error);
            showStatusMessage('Error loading courses. Please try again.', 'error');
        } finally {
            loadingElement.style.display = 'none';
        }
    }

    // Function to render the courses
    function renderCourses(courses) {
        courseListElement.innerHTML = '';
        
        // Sort courses by name
        courses.sort((a, b) => a.name.localeCompare(b.name));
        
        courses.forEach(course => {
            const courseCard = document.createElement('div');
            courseCard.className = 'course-card';
            
            const courseName = document.createElement('div');
            courseName.className = 'course-name';
            courseName.textContent = course.name;
            
            const courseSection = document.createElement('div');
            courseSection.className = 'course-section';
            courseSection.textContent = course.section || 'No section';
            
            const courseState = document.createElement('div');
            courseState.className = 'course-state';
            courseState.textContent = `Status: ${formatCourseState(course.courseState)}`;
            
            const courseActions = document.createElement('div');
            courseActions.className = 'course-actions';
            
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn download-btn';
            
            // Add download icon
            downloadBtn.innerHTML = `
                <svg class="download-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">
                    <path fill="#fff" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
                Download All Materials
            `;
            
            downloadBtn.addEventListener('click', () => downloadCourseMaterials(course.id, course.name));
            
            courseActions.appendChild(downloadBtn);
            
            courseCard.appendChild(courseName);
            courseCard.appendChild(courseSection);
            courseCard.appendChild(courseState);
            courseCard.appendChild(courseActions);
            
            courseListElement.appendChild(courseCard);
        });
    }

    // Function to format course state
    function formatCourseState(state) {
        switch(state) {
            case 'ACTIVE':
                return 'Active';
            case 'ARCHIVED':
                return 'Archived';
            case 'PROVISIONED':
                return 'Provisioned';
            case 'DECLINED':
                return 'Declined';
            case 'SUSPENDED':
                return 'Suspended';
            default:
                return state;
        }
    }

    // Function to download course materials
    function downloadCourseMaterials(courseId, courseName) {
        // Show loading spinner
        downloadLoadingElement.style.display = 'block';
        
        // Create an iframe for downloading
        const downloadFrame = document.createElement('iframe');
        downloadFrame.style.display = 'none';
        document.body.appendChild(downloadFrame);
        
        // Set the source to trigger the download
        downloadFrame.src = `${backendUrl}/courses/${courseId}/download`;
        
        // Hide loading spinner after a timeout or when iframe loads
        downloadFrame.onload = function() {
            downloadLoadingElement.style.display = 'none';
            setTimeout(() => {
                document.body.removeChild(downloadFrame);
            }, 2000);
        };
        
        // Fallback in case onload doesn't fire
        setTimeout(() => {
            downloadLoadingElement.style.display = 'none';
            if (document.body.contains(downloadFrame)) {
                document.body.removeChild(downloadFrame);
            }
        }, 30000); // 30 seconds timeout
        
        showStatusMessage(`Downloading materials for "${courseName}". If the download doesn't start automatically, click the button again.`, 'success');
    }

    // Function to show status messages
    function showStatusMessage(message, type) {
        let icon = '';
        
        if (type === 'success') {
            icon = `<svg class="status-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                <path fill="#2e7d32" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>`;
        } else {
            icon = `<svg class="status-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
                <path fill="#c62828" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>`;
        }
        
        statusMessageElement.innerHTML = icon + message;
        statusMessageElement.className = `status-message ${type === 'error' ? 'status-error' : 'status-success'}`;
        statusMessageElement.classList.remove('hidden');
        
        // Hide the message after 5 seconds
        setTimeout(() => {
            statusMessageElement.classList.add('hidden');
        }, 5000);
    }
});
